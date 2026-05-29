/// Consumer of raw PTY output bytes.
///
/// The PTY reader fans out every chunk it receives to all registered sinks
/// (D4: channel sink for the live UI, scrollback sink for replay, etc.).
///
/// Implementations MUST NOT block longer than ~1ms inside [`write`]; anything
/// slower backs up the PTY reader and risks dropping or stalling output.
/// Move heavy work (I/O, large allocations, cross-thread coordination) onto a
/// dedicated task and hand it bytes through a non-blocking channel.
pub trait OutputSink: Send + Sync {
    fn write(&self, bytes: &[u8]);
}

#[cfg(test)]
pub(crate) mod test_support {
    use std::sync::Mutex;

    use super::OutputSink;

    pub struct VecSink(Mutex<Vec<u8>>);

    impl VecSink {
        pub fn new() -> Self {
            Self(Mutex::new(Vec::new()))
        }

        pub fn snapshot(&self) -> Vec<u8> {
            self.0.lock().expect("VecSink mutex poisoned").clone()
        }
    }

    impl Default for VecSink {
        fn default() -> Self {
            Self::new()
        }
    }

    impl OutputSink for VecSink {
        fn write(&self, bytes: &[u8]) {
            self.0
                .lock()
                .expect("VecSink mutex poisoned")
                .extend_from_slice(bytes);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::test_support::VecSink;
    use super::OutputSink;

    #[test]
    fn vec_sink_records_writes_in_order() {
        let sink = VecSink::new();
        sink.write(b"hello ");
        sink.write(b"world");
        assert_eq!(sink.snapshot(), b"hello world");
    }

    #[test]
    fn fan_out_through_arc_dyn_sinks() {
        let a = Arc::new(VecSink::new());
        let b = Arc::new(VecSink::new());
        let sinks: Vec<Arc<dyn OutputSink>> = vec![
            Arc::clone(&a) as Arc<dyn OutputSink>,
            Arc::clone(&b) as Arc<dyn OutputSink>,
        ];

        for sink in &sinks {
            sink.write(b"chunk");
        }

        assert_eq!(a.snapshot(), b"chunk");
        assert_eq!(b.snapshot(), b"chunk");
    }
}
