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
}

fn rerun_if_changed_recursive(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            rerun_if_changed_recursive(&path);
        } else {
            println!("cargo:rerun-if-changed={}", path.display());
        }
    }
}
