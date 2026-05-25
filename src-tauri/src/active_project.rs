use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Default)]
pub struct ActiveProject(Mutex<Option<PathBuf>>);

impl ActiveProject {
    pub fn set(&self, path: PathBuf) {
        let mut guard = self.0.lock().expect("ActiveProject mutex poisoned");
        *guard = Some(path);
    }

    pub fn get(&self) -> Option<PathBuf> {
        self.0.lock().expect("ActiveProject mutex poisoned").clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn returns_none_when_unset() {
        let active = ActiveProject::default();
        assert!(active.get().is_none());
    }

    #[test]
    fn returns_last_set_path() {
        let active = ActiveProject::default();
        active.set(PathBuf::from("/tmp/first"));
        active.set(PathBuf::from("/tmp/second"));
        assert_eq!(active.get(), Some(PathBuf::from("/tmp/second")));
    }
}
