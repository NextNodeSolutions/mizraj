use std::env;
use std::path::{Path, PathBuf};

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let default_include = manifest_dir.join("vendor").join("include");

    let include_dir = env::var_os("LIBGHOSTTY_INCLUDE_DIR")
        .map(PathBuf::from)
        .unwrap_or(default_include);

    println!("cargo:rerun-if-env-changed=LIBGHOSTTY_INCLUDE_DIR");
    println!("cargo:rerun-if-changed=build.rs");
    rerun_if_changed_recursive(&include_dir);

    let entry_header = include_dir.join("ghostty").join("vt.h");
    assert!(
        entry_header.is_file(),
        "libghostty entry header not found at {} (set LIBGHOSTTY_INCLUDE_DIR to override)",
        entry_header.display()
    );

    let bindings = bindgen::Builder::default()
        .header(entry_header.to_string_lossy())
        .clang_arg(format!("-I{}", include_dir.display()))
        .allowlist_function("ghostty_.*")
        .allowlist_type("[Gg]hostty.*|GHOSTTY_.*")
        .allowlist_var("GHOSTTY_.*")
        .layout_tests(false)
        .generate()
        .expect("bindgen failed to generate libghostty-vt bindings");

    let out_path = PathBuf::from(env::var_os("OUT_DIR").unwrap()).join("bindings.rs");
    bindings
        .write_to_file(&out_path)
        .expect("failed to write bindings.rs");

    emit_link_flags();
}

fn emit_link_flags() {
    println!("cargo:rerun-if-env-changed=LIBGHOSTTY_LIB_DIR");

    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    match target_os.as_str() {
        "macos" => emit_link_flags_macos(),
        "linux" => emit_link_flags_linux(),
        _ => {}
    }
}

fn emit_link_flags_macos() {
    let lib_dir = env::var_os("LIBGHOSTTY_LIB_DIR").map(PathBuf::from);

    match lib_dir {
        Some(dir) if dir.join("libghostty.dylib").is_file() => {
            println!("cargo:rustc-link-search=native={}", dir.display());
            println!("cargo:rustc-link-lib=dylib=ghostty");
            // Match the Linux side: embed an rpath relative to the binary
            // so the dylib can sit next to the executable in dev runs and
            // packaged builds without `DYLD_LIBRARY_PATH` gymnastics.
            println!("cargo:rustc-link-arg=-Wl,-rpath,@loader_path");
            println!("cargo:rustc-link-arg=-Wl,-rpath,@executable_path");
        }
        Some(dir) => {
            println!(
                "cargo:warning=libghostty.dylib not found at {} - set LIBGHOSTTY_LIB_DIR to the directory containing it",
                dir.display()
            );
        }
        None => {
            println!(
                "cargo:warning=LIBGHOSTTY_LIB_DIR is not set - downstream binaries that use agent-cockpit-term-sys will fail to link; export it to the directory containing libghostty.dylib"
            );
        }
    }
}

fn emit_link_flags_linux() {
    let lib_dir = env::var_os("LIBGHOSTTY_LIB_DIR").map(PathBuf::from);

    match lib_dir {
        Some(dir) if dir.join("libghostty.so").is_file() => {
            println!("cargo:rustc-link-search=native={}", dir.display());
            println!("cargo:rustc-link-lib=dylib=ghostty");
            println!("cargo:rustc-link-arg=-Wl,-rpath,$ORIGIN");
        }
        Some(dir) => {
            println!(
                "cargo:warning=libghostty.so not found at {} - set LIBGHOSTTY_LIB_DIR to the directory containing it",
                dir.display()
            );
        }
        None => {
            println!(
                "cargo:warning=LIBGHOSTTY_LIB_DIR is not set - downstream binaries that use agent-cockpit-term-sys will fail to link; export it to the directory containing libghostty.so"
            );
        }
    }
}

fn rerun_if_changed_recursive(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            rerun_if_changed_recursive(&path);
        } else {
            println!("cargo:rerun-if-changed={}", path.display());
        }
    }
}
