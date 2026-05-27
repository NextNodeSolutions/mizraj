use std::path::PathBuf;
use std::sync::{Mutex, PoisonError};

#[derive(Default)]
pub struct ActiveProject(Mutex<Option<PathBuf>>);

impl ActiveProject {
    pub fn set(&self, path: PathBuf) {
        let mut guard = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        *guard = Some(path);
    }

    pub fn clear(&self) {
        let mut guard = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        *guard = None;
    }

    pub fn get(&self) -> Option<PathBuf> {
        self.0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
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

    #[test]
    fn clear_resets_to_none() {
        let active = ActiveProject::default();
        active.set(PathBuf::from("/tmp/here"));
        active.clear();
        assert!(active.get().is_none());
    }
}
