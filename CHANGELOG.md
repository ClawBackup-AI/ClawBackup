# Changelog

All notable changes to ClawBackup will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-03-25

### Added
- **File Change Tracking** - Automatically track file changes during Agent sessions
- **Time Travel Rollback** - Rollback to any point in time (minutes, hours, or previous sessions)
- **Rollback Preview** - Preview changes before executing rollback
- **Event Sourcing Architecture** - Events table + Snapshots table separation for efficient storage
- **Content Deduplication** - SHA256-based content deduplication to reduce storage usage
- **Session-level File Tracking** - Track all file modifications within a session
- **Snapshot CLI Commands** - `snapshot status`, `snapshot list`, `snapshot rollback`, `snapshot cleanup`
- **Snapshot Agent Tools** - `snapshot_status`, `snapshot_list`, `snapshot_rollback`, `snapshot_history`
- **Directory Operation Support** - Recursive handling of directory operations
- **Hook Integration** - `before_tool_call`, `session_start`, `session_end` hooks for automatic tracking

### Changed
- Optimized README structure to highlight core value proposition
- Added conversation and command examples for rollback functionality
- Added example screenshots for rollback demonstration

### Fixed
- Content unchanged detection in snapshot manager
- Bash command parsing with quoted paths
- Snapshot deletion with reference count checking
- File deletion handling for directories
- Stream creation compatibility for Buffer content

## [1.0.0] - 2026-03-24

### Added
- Initial release of ClawBackup
- Local backup with encryption support (AES-256-CBC)
- Cloud storage sync (S3/OSS compatible)
- Backup verification and integrity checking
- Snapshot rollback support
- Cross-device recovery
- Streaming upload/download for large files
- Multi-storage backend support (local, S3, OSS, COS, MinIO)
- Bilingual documentation (English and Chinese)

### Security
- Path traversal vulnerability protection in LocalStorageBackend
- Secure encryption key management with AES-256-GCM
- Sensitive credentials encryption in storage backend config
- Apache 2.0 License with comprehensive disclaimer

### Fixed
- File descriptor leak in decryption stream
- Dangerous file deletion logic in backup publishing
- S3 connection test using wrong API parameter
- Encryption key cache sharing across multiple instances
- Sync and delete operations with absolute paths
- Restore default path to correct ~/.openclaw directory

[1.1.0]: https://github.com/ClawBackup-AI/ClawBackup/releases/tag/v1.1.0
[1.0.0]: https://github.com/ClawBackup-AI/ClawBackup/releases/tag/v1.0.0
