//! A structured config problem, surfaced rather than silently dropped.

/// A config value the loader or resolver could not apply. Kept so the host can
/// show the user exactly what went wrong — which key, the offending value, and
/// why — without the terminal failing to start over a config typo.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Diagnostic {
    /// The config key the problem relates to (or `config-file` / `theme`).
    pub key: String,
    /// The offending value, verbatim.
    pub value: String,
    /// A short, human-readable reason.
    pub message: String,
}

impl Diagnostic {
    pub(crate) fn new(
        key: impl Into<String>,
        value: impl Into<String>,
        message: impl Into<String>,
    ) -> Diagnostic {
        Diagnostic {
            key: key.into(),
            value: value.into(),
            message: message.into(),
        }
    }
}
