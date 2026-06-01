use agent_cockpit_term::Mods;
use serde::Deserialize;

/// A single key press forwarded from the frontend.
///
/// The webview captures the `KeyboardEvent` and sends its raw fields verbatim;
/// all VT encoding happens in the backend via libghostty's key encoder (which
/// is mode-aware — see [`crate::session::term_sink`]), never in JS. Super/Cmd is
/// filtered out on the frontend because it belongs to the app, not the PTY.
#[derive(Debug, Clone, Deserialize)]
pub struct KeyStroke {
    /// W3C `KeyboardEvent.code` — the physical key (e.g. `"KeyA"`, `"ArrowUp"`).
    pub code: String,
    /// Layout text (`KeyboardEvent.key`) for printable keys, otherwise `None`.
    pub text: Option<String>,
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
}

impl KeyStroke {
    /// The active modifiers in the shape the term crate's encoder expects.
    pub fn mods(&self) -> Mods {
        Mods {
            ctrl: self.ctrl,
            alt: self.alt,
            shift: self.shift,
        }
    }
}
