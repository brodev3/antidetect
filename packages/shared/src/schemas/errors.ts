/**
 * Canonical error codes shared across services and exposed via the public API.
 */
export enum ErrorCode {
  NameTaken = 'name_taken',
  ProfileDirExists = 'profile_dir_exists',
  FsError = 'fs_error',
  ProfileNotFound = 'profile_not_found',
  ProfileStorageNotFound = 'profile_storage_not_found',
  SettingsNotFound = 'settings_not_found',
  SettingsSaveFailed = 'settings_save_failed',
  ProxyUnsupportedType = 'proxy_unsupported_type',
  ProxyCheckFailed = 'proxy_check_failed',
  LaunchTimeout = 'launch_timeout',
  LaunchFailed = 'launch_failed',
  FingerprintFailed = 'fingerprint_failed',
  TemplateNotFound = 'template_not_found',
  ProfileIsOpen = 'profile_is_open',
}

/**
 * Maps an internal error code to an HTTP status and default message payload.
 */
export function mapErrorCodeToHttp(code: ErrorCode) {
  switch (code) {
    case ErrorCode.NameTaken:
    case ErrorCode.ProfileDirExists:
    case ErrorCode.ProfileIsOpen:
      return { status: 409, message: code };
    case ErrorCode.ProfileNotFound:
    case ErrorCode.SettingsNotFound:
    case ErrorCode.TemplateNotFound:
      return { status: 404, message: code };
    case ErrorCode.ProfileStorageNotFound:
      return { status: 410, message: code };
    case ErrorCode.ProxyUnsupportedType:
      return { status: 400, message: code };
    case ErrorCode.ProxyCheckFailed:
      return { status: 502, message: code };
    case ErrorCode.LaunchTimeout:
      return { status: 504, message: code };
    case ErrorCode.FsError:
    case ErrorCode.LaunchFailed:
    case ErrorCode.FingerprintFailed:
      return { status: 500, message: code };
    default:
      return { status: 500, message: 'internal_error' };
  }
}
