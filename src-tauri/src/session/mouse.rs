//! Wire DTO for frontend mouse events (TP10).
//!
//! Mirrors the camel-free snake_case shape `session_mouse` receives from the
//! pane's mouse layer; converted into the typed [`MouseInput`] the render
//! thread encodes against the live tracking mode.

use mizraj_term::{Mods, MouseAction, MouseButton, MouseInput};
use serde::Deserialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MouseKindDto {
    Press,
    Release,
    Motion,
    WheelUp,
    WheelDown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MouseButtonDto {
    None,
    Left,
    Right,
    Middle,
}

/// One mouse event in 0-based cell coordinates, as the frontend reports it.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
pub struct MouseEventDto {
    pub kind: MouseKindDto,
    pub button: MouseButtonDto,
    pub col: u16,
    pub row: u16,
    pub shift: bool,
    pub ctrl: bool,
    pub alt: bool,
}

impl From<MouseEventDto> for MouseInput {
    fn from(dto: MouseEventDto) -> Self {
        MouseInput {
            action: match dto.kind {
                MouseKindDto::Press => MouseAction::Press,
                MouseKindDto::Release => MouseAction::Release,
                MouseKindDto::Motion => MouseAction::Motion,
                MouseKindDto::WheelUp => MouseAction::WheelUp,
                MouseKindDto::WheelDown => MouseAction::WheelDown,
            },
            button: match dto.button {
                MouseButtonDto::None => MouseButton::None,
                MouseButtonDto::Left => MouseButton::Left,
                MouseButtonDto::Right => MouseButton::Right,
                MouseButtonDto::Middle => MouseButton::Middle,
            },
            col: dto.col,
            row: dto.row,
            mods: Mods {
                ctrl: dto.ctrl,
                alt: dto.alt,
                shift: dto.shift,
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserializes_the_frontend_shape_and_converts() {
        let dto: MouseEventDto = serde_json::from_str(
            r#"{"kind":"wheel_down","button":"none","col":3,"row":7,"shift":false,"ctrl":true,"alt":false}"#,
        )
        .expect("deserialize");

        let input = MouseInput::from(dto);
        assert_eq!(input.action, MouseAction::WheelDown);
        assert_eq!(input.button, MouseButton::None);
        assert_eq!((input.col, input.row), (3, 7));
        assert!(input.mods.ctrl && !input.mods.shift);
    }
}
