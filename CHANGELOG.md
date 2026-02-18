# Changelog

## [2.3.0] - 2026-02-18
### Added
- **Jump Scroll Feature**: Introduced a snappy, short-distance scroll triggered by quick key taps.
- **Configurable Scroll Settings**: Added `tapThreshold`, `jumpDistance`, and `jumpDuration` to `SCROLL_CONFIG` for fine-tuning.

### Changed
- Improved scroll responsiveness by decoupling tap-to-jump from hold-to-scroll.
- Refined momentum decay for smoother stopping when releasing keys during long scrolls.

### Fixed
- Fixed potential scroll "stutter" when quickly switching directions.
