//! Mouse event encoding via libghostty (X10/UTF-8/SGR/URxvt/SGR-Pixels).
//!
//! Mirrors `key.rs`: a stateful encoder allocated once per terminal whose
//! options re-sync from the terminal's live mouse modes before every encode,
//! so the output always matches what the running child negotiated.
//!
//! Coordinates: the caller works in CELLS. The encoder is configured with a
//! 1×1px cell geometry so surface-space "pixels" coincide with cell indices —
//! exact for every cell-based protocol; only SGR-Pixels (rare) degrades to
//! cell-granular positions.

use std::ptr::{self, NonNull};

use mizraj_term_sys::{
    ghostty_mouse_encoder_encode, ghostty_mouse_encoder_free, ghostty_mouse_encoder_new,
    ghostty_mouse_encoder_setopt, ghostty_mouse_encoder_setopt_from_terminal,
    ghostty_mouse_event_clear_button, ghostty_mouse_event_free, ghostty_mouse_event_new,
    ghostty_mouse_event_set_action, ghostty_mouse_event_set_button, ghostty_mouse_event_set_mods,
    ghostty_mouse_event_set_position, GhosttyMouseAction_GHOSTTY_MOUSE_ACTION_MOTION,
    GhosttyMouseAction_GHOSTTY_MOUSE_ACTION_PRESS, GhosttyMouseAction_GHOSTTY_MOUSE_ACTION_RELEASE,
    GhosttyMouseButton_GHOSTTY_MOUSE_BUTTON_FIVE, GhosttyMouseButton_GHOSTTY_MOUSE_BUTTON_FOUR,
    GhosttyMouseButton_GHOSTTY_MOUSE_BUTTON_LEFT, GhosttyMouseButton_GHOSTTY_MOUSE_BUTTON_MIDDLE,
    GhosttyMouseButton_GHOSTTY_MOUSE_BUTTON_RIGHT, GhosttyMouseEncoderImpl,
    GhosttyMouseEncoderOption_GHOSTTY_MOUSE_ENCODER_OPT_SIZE, GhosttyMouseEncoderSize,
    GhosttyMouseEventImpl, GhosttyMousePosition, GhosttyResult_GHOSTTY_OUT_OF_SPACE,
    GhosttyResult_GHOSTTY_SUCCESS,
};

use crate::{Mods, Result, TermError, Terminal};

/// What happened, in the caller's vocabulary.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MouseAction {
    Press,
    Release,
    Motion,
    WheelUp,
    WheelDown,
}

/// Which button, for press/release/drag events.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MouseButton {
    None,
    Left,
    Right,
    Middle,
}

/// One mouse event in cell coordinates (0-based column/row).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MouseInput {
    pub action: MouseAction,
    pub button: MouseButton,
    pub col: u16,
    pub row: u16,
    pub mods: Mods,
}

/// Stateful libghostty mouse encoder bound to cell-unit geometry.
#[derive(Debug)]
pub struct MouseEncoder {
    encoder: NonNull<GhosttyMouseEncoderImpl>,
    event: NonNull<GhosttyMouseEventImpl>,
}

impl MouseEncoder {
    pub fn new() -> Result<Self> {
        let mut encoder_raw = ptr::null_mut();
        // SAFETY: NULL allocator selects the default per the header; the out
        // pointer targets a local.
        let result = unsafe { ghostty_mouse_encoder_new(ptr::null(), &mut encoder_raw) };
        if result != GhosttyResult_GHOSTTY_SUCCESS {
            return Err(TermError::Init(format!(
                "ghostty_mouse_encoder_new returned {result}"
            )));
        }
        let encoder = NonNull::new(encoder_raw)
            .ok_or_else(|| TermError::Init("ghostty_mouse_encoder_new returned NULL".into()))?;

        let mut event_raw = ptr::null_mut();
        // SAFETY: same contract as encoder_new.
        let result = unsafe { ghostty_mouse_event_new(ptr::null(), &mut event_raw) };
        if result != GhosttyResult_GHOSTTY_SUCCESS {
            // SAFETY: encoder is live and not used after this free.
            unsafe { ghostty_mouse_encoder_free(encoder.as_ptr()) };
            return Err(TermError::Init(format!(
                "ghostty_mouse_event_new returned {result}"
            )));
        }
        let event = match NonNull::new(event_raw) {
            Some(p) => p,
            None => {
                // SAFETY: encoder is live and not used after this free.
                unsafe { ghostty_mouse_encoder_free(encoder.as_ptr()) };
                return Err(TermError::Init(
                    "ghostty_mouse_event_new returned NULL".into(),
                ));
            }
        };

        Ok(Self { encoder, event })
    }

    /// Keep the encoder's geometry in cell units, sized to the live grid.
    fn sync_size(&mut self, terminal: &Terminal) {
        let size = GhosttyMouseEncoderSize {
            size: size_of::<GhosttyMouseEncoderSize>(),
            screen_width: u32::from(terminal.cols()),
            screen_height: u32::from(terminal.rows()),
            cell_width: 1,
            cell_height: 1,
            padding_top: 0,
            padding_bottom: 0,
            padding_right: 0,
            padding_left: 0,
        };
        // SAFETY: encoder is live; `size` is a fully initialized POD whose
        // address is only read for the duration of the call.
        unsafe {
            ghostty_mouse_encoder_setopt(
                self.encoder.as_ptr(),
                GhosttyMouseEncoderOption_GHOSTTY_MOUSE_ENCODER_OPT_SIZE,
                (&raw const size).cast(),
            );
        }
    }

    /// Encode one event against the terminal's live mouse modes. Returns an
    /// empty Vec when the current mode produces no output for this event
    /// (tracking off, motion without tracking, …) — the caller sends nothing.
    pub fn encode(&mut self, terminal: &Terminal, input: &MouseInput) -> Result<Vec<u8>> {
        // SAFETY: encoder + terminal handles are live (`&Terminal` guarantees
        // the terminal hasn't been dropped).
        unsafe {
            ghostty_mouse_encoder_setopt_from_terminal(
                self.encoder.as_ptr(),
                terminal.raw_handle(),
            );
        }
        self.sync_size(terminal);

        let (action, button) = match input.action {
            MouseAction::Press => (
                GhosttyMouseAction_GHOSTTY_MOUSE_ACTION_PRESS,
                Some(input.button),
            ),
            MouseAction::Release => (
                GhosttyMouseAction_GHOSTTY_MOUSE_ACTION_RELEASE,
                Some(input.button),
            ),
            MouseAction::Motion => (
                GhosttyMouseAction_GHOSTTY_MOUSE_ACTION_MOTION,
                Some(input.button),
            ),
            // Wheel ticks are encoded as presses of buttons four/five, the VT
            // convention every protocol shares.
            MouseAction::WheelUp => (GhosttyMouseAction_GHOSTTY_MOUSE_ACTION_PRESS, None),
            MouseAction::WheelDown => (GhosttyMouseAction_GHOSTTY_MOUSE_ACTION_PRESS, None),
        };

        // SAFETY (all setters below): the event handle is live for the whole
        // block; values are plain enums/PODs.
        unsafe {
            ghostty_mouse_event_set_action(self.event.as_ptr(), action);
            match input.action {
                MouseAction::WheelUp => ghostty_mouse_event_set_button(
                    self.event.as_ptr(),
                    GhosttyMouseButton_GHOSTTY_MOUSE_BUTTON_FOUR,
                ),
                MouseAction::WheelDown => ghostty_mouse_event_set_button(
                    self.event.as_ptr(),
                    GhosttyMouseButton_GHOSTTY_MOUSE_BUTTON_FIVE,
                ),
                _ => match button.unwrap_or(MouseButton::None) {
                    MouseButton::None => ghostty_mouse_event_clear_button(self.event.as_ptr()),
                    MouseButton::Left => ghostty_mouse_event_set_button(
                        self.event.as_ptr(),
                        GhosttyMouseButton_GHOSTTY_MOUSE_BUTTON_LEFT,
                    ),
                    MouseButton::Right => ghostty_mouse_event_set_button(
                        self.event.as_ptr(),
                        GhosttyMouseButton_GHOSTTY_MOUSE_BUTTON_RIGHT,
                    ),
                    MouseButton::Middle => ghostty_mouse_event_set_button(
                        self.event.as_ptr(),
                        GhosttyMouseButton_GHOSTTY_MOUSE_BUTTON_MIDDLE,
                    ),
                },
            }
            ghostty_mouse_event_set_mods(self.event.as_ptr(), input.mods.to_ghostty());
            // Mid-cell so integer truncation can never flip to a neighbor.
            ghostty_mouse_event_set_position(
                self.event.as_ptr(),
                GhosttyMousePosition {
                    x: f32::from(input.col) + 0.5,
                    y: f32::from(input.row) + 0.5,
                },
            );
        }

        self.encode_bytes()
    }

    fn encode_bytes(&mut self) -> Result<Vec<u8>> {
        let mut buf = vec![0u8; 64];
        loop {
            let mut written: usize = 0;
            // SAFETY: encoder/event are live; buf is a valid writable region of
            // the stated length; written is a local out-param.
            let result = unsafe {
                ghostty_mouse_encoder_encode(
                    self.encoder.as_ptr(),
                    self.event.as_ptr(),
                    buf.as_mut_ptr().cast(),
                    buf.len(),
                    &mut written,
                )
            };
            if result == GhosttyResult_GHOSTTY_SUCCESS {
                buf.truncate(written);
                return Ok(buf);
            }
            if result == GhosttyResult_GHOSTTY_OUT_OF_SPACE {
                buf = vec![0u8; written.max(buf.len() * 2)];
                continue;
            }
            return Err(TermError::Encode(format!(
                "ghostty_mouse_encoder_encode returned {result}"
            )));
        }
    }
}

impl Drop for MouseEncoder {
    fn drop(&mut self) {
        // SAFETY: both handles were created in `new`, freed exactly once here,
        // and never observed afterwards.
        unsafe {
            ghostty_mouse_event_free(self.event.as_ptr());
            ghostty_mouse_encoder_free(self.encoder.as_ptr());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn encoder_and_terminal(setup: &[u8]) -> (MouseEncoder, Terminal) {
        let mut terminal = Terminal::new(24, 80).expect("terminal");
        terminal.feed(setup).expect("feed setup");
        (MouseEncoder::new().expect("encoder"), terminal)
    }

    fn input(action: MouseAction, button: MouseButton, col: u16, row: u16) -> MouseInput {
        MouseInput {
            action,
            button,
            col,
            row,
            mods: Mods {
                ctrl: false,
                alt: false,
                shift: false,
            },
        }
    }

    #[test]
    fn no_tracking_mode_encodes_nothing() {
        let (mut encoder, terminal) = encoder_and_terminal(b"");

        let bytes = encoder
            .encode(
                &terminal,
                &input(MouseAction::Press, MouseButton::Left, 0, 0),
            )
            .expect("encode");

        assert!(bytes.is_empty(), "tracking off must produce no bytes");
    }

    #[test]
    fn sgr_mode_encodes_press_and_release_at_one_based_cells() {
        // 1000h = normal tracking, 1006h = SGR format (what vim enables).
        let (mut encoder, terminal) = encoder_and_terminal(b"\x1b[?1000h\x1b[?1006h");

        let press = encoder
            .encode(
                &terminal,
                &input(MouseAction::Press, MouseButton::Left, 2, 4),
            )
            .expect("encode press");
        assert_eq!(press, b"\x1b[<0;3;5M");

        let release = encoder
            .encode(
                &terminal,
                &input(MouseAction::Release, MouseButton::Left, 2, 4),
            )
            .expect("encode release");
        assert_eq!(release, b"\x1b[<0;3;5m");
    }

    #[test]
    fn wheel_ticks_encode_as_buttons_four_and_five() {
        let (mut encoder, terminal) = encoder_and_terminal(b"\x1b[?1000h\x1b[?1006h");

        let up = encoder
            .encode(
                &terminal,
                &input(MouseAction::WheelUp, MouseButton::None, 0, 0),
            )
            .expect("encode wheel up");
        assert_eq!(up, b"\x1b[<64;1;1M");

        let down = encoder
            .encode(
                &terminal,
                &input(MouseAction::WheelDown, MouseButton::None, 0, 0),
            )
            .expect("encode wheel down");
        assert_eq!(down, b"\x1b[<65;1;1M");
    }
}
