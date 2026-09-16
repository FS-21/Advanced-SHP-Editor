// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::env;

#[tauri::command]
fn register_file_associations(extensions: Vec<String>) -> Result<String, String> {
    let current_exe = env::current_exe().map_err(|e| e.to_string())?;
    let exe_path = current_exe.to_string_lossy().to_string();

    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let classes = hkcu.open_subkey_with_flags("Software\\Classes", KEY_ALL_ACCESS)
            .map_err(|e| format!("Failed to open HKCU\\Software\\Classes: {}", e))?;

        for ext in &extensions {
            let clean_ext = ext.trim_start_matches('.');
            let prog_id = format!("AdvancedSHPEditor.{}", clean_ext);

            let (ext_key, _) = classes.create_subkey(format!(".{}", clean_ext))
                .map_err(|e| format!("Failed to create .{} subkey: {}", clean_ext, e))?;
            ext_key.set_value("", &prog_id)
                .map_err(|e| format!("Failed to set default value for .{}: {}", clean_ext, e))?;

            let (prog_key, _) = classes.create_subkey(&prog_id)
                .map_err(|e| format!("Failed to create prog_id {}: {}", prog_id, e))?;
            let desc = format!("Command & Conquer {} File", clean_ext.to_uppercase());
            let _ = prog_key.set_value("", &desc);

            if let Ok((icon_key, _)) = prog_key.create_subkey("DefaultIcon") {
                let _ = icon_key.set_value("", &format!("\"{}\",0", exe_path));
            }

            let (cmd_key, _) = prog_key.create_subkey("shell\\open\\command")
                .map_err(|e| format!("Failed to create command key: {}", e))?;
            cmd_key.set_value("", &format!("\"{}\" \"%1\"", exe_path))
                .map_err(|e| format!("Failed to set open command: {}", e))?;
        }

        return Ok(format!("Successfully associated {} extension(s) in Windows registry.", extensions.len()));
    }

    #[cfg(target_os = "linux")]
    {
        use std::fs;
        use std::process::Command;

        let home = env::var("HOME").unwrap_or_else(|_| ".".into());
        let apps_dir = format!("{}/.local/share/applications", home);
        let _ = fs::create_dir_all(&apps_dir);

        let desktop_content = format!(
            "[Desktop Entry]\n\
            Name=Advanced SHP Editor\n\
            Comment=Advanced SHP Sprite Editor for Tiberian Sun & Red Alert 2\n\
            Exec=\"{}\" %U\n\
            Terminal=false\n\
            Type=Application\n\
            Icon=advanced-shp-editor\n\
            Categories=Graphics;2DGraphics;RasterGraphics;\n\
            MimeType=application/x-wwn-shp;application/x-wwn-sha;\n",
            exe_path
        );

        let desktop_file = format!("{}/advanced-shp-editor.desktop", apps_dir);
        let _ = fs::write(&desktop_file, desktop_content);

        for ext in &extensions {
            let clean = ext.trim_start_matches('.');
            let mime = format!("application/x-wwn-{}", clean);
            let _ = Command::new("xdg-mime")
                .args(["default", "advanced-shp-editor.desktop", &mime])
                .status();
        }

        return Ok("Successfully registered desktop file and mime types.".into());
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        Ok("File association not supported on this platform.".into())
    }
}

#[tauri::command]
fn unregister_file_associations(extensions: Vec<String>) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if let Ok(classes) = hkcu.open_subkey_with_flags("Software\\Classes", KEY_ALL_ACCESS) {
            for ext in &extensions {
                let clean_ext = ext.trim_start_matches('.');
                let prog_id = format!("AdvancedSHPEditor.{}", clean_ext);
                let _ = classes.delete_subkey_all(format!(".{}", clean_ext));
                let _ = classes.delete_subkey_all(&prog_id);
            }
        }
        return Ok("Unregistered associations from Windows registry.".into());
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok("Unregister not required on this platform.".into())
    }
}

#[tauri::command]
fn check_file_associations() -> Result<Vec<String>, String> {
    let mut associated = Vec::new();

    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if let Ok(classes) = hkcu.open_subkey_with_flags("Software\\Classes", KEY_READ) {
            for ext in ["shp", "sha", "tem", "sno", "urb", "ubn", "des", "lun"] {
                if let Ok(ext_key) = classes.open_subkey(format!(".{}", ext)) {
                    if let Ok(val) = ext_key.get_value::<String, _>("") {
                        if val.starts_with("AdvancedSHPEditor.") {
                            associated.push(ext.to_string());
                        }
                    }
                }
            }
        }
    }

    Ok(associated)
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        Command::new("cmd")
            .args(["/C", "start", "", &url])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        use std::process::Command;
        Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        Ok(())
    }
}

#[derive(serde::Deserialize)]
struct FileFilterInfo {
    name: String,
    extensions: Vec<String>,
}

#[tauri::command]
fn read_file_binary(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| format!("Failed to read file '{}': {}", path, e))
}

#[tauri::command]
fn write_file_binary(path: String, data: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, &data).map_err(|e| format!("Failed to write file '{}': {}", path, e))
}

#[tauri::command]
fn pick_open_file(title: Option<String>, filters: Vec<FileFilterInfo>, multiple: Option<bool>) -> Result<Option<Vec<String>>, String> {
    let mut dialog = rfd::FileDialog::new();
    if let Some(t) = title {
        dialog = dialog.set_title(&t);
    }
    for f in &filters {
        let exts: Vec<&str> = f.extensions.iter().map(|s| s.as_str()).collect();
        dialog = dialog.add_filter(&f.name, &exts);
    }
    if multiple.unwrap_or(false) {
        let res = dialog.pick_files();
        Ok(res.map(|paths| paths.into_iter().map(|p| p.to_string_lossy().to_string()).collect()))
    } else {
        let res = dialog.pick_file();
        Ok(res.map(|p| vec![p.to_string_lossy().to_string()]))
    }
}

#[tauri::command]
fn pick_save_file(default_name: Option<String>, title: Option<String>, filters: Vec<FileFilterInfo>) -> Result<Option<String>, String> {
    let mut dialog = rfd::FileDialog::new();
    if let Some(t) = title {
        dialog = dialog.set_title(&t);
    }
    if let Some(name) = default_name {
        dialog = dialog.set_file_name(&name);
    }
    for f in &filters {
        let exts: Vec<&str> = f.extensions.iter().map(|s| s.as_str()).collect();
        dialog = dialog.add_filter(&f.name, &exts);
    }
    let res = dialog.save_file();
    Ok(res.map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
fn get_cli_args() -> Vec<String> {
    std::env::args().skip(1).collect()
}

#[tauri::command]
fn force_exit_app() {
    std::process::exit(0);
}

#[derive(serde::Serialize)]
struct ClipboardImageResult {
    width: usize,
    height: usize,
    rgba: Vec<u8>,
}

#[tauri::command]
fn read_clipboard_image() -> Result<Option<ClipboardImageResult>, String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    match clipboard.get_image() {
        Ok(img) => Ok(Some(ClipboardImageResult {
            width: img.width,
            height: img.height,
            rgba: img.bytes.into_owned(),
        })),
        Err(arboard::Error::ContentNotAvailable) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn write_clipboard_image(width: usize, height: usize, rgba: Vec<u8>) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    let img_data = arboard::ImageData {
        width,
        height,
        bytes: std::borrow::Cow::from(rgba),
    };
    clipboard.set_image(img_data).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn read_clipboard_text() -> Result<Option<String>, String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    match clipboard.get_text() {
        Ok(t) => Ok(Some(t)),
        Err(arboard::Error::ContentNotAvailable) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn write_clipboard_text(text: String) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.set_text(text).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_file_modified_time(path: String) -> Result<u64, String> {
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    let modified = meta.modified().map_err(|e| e.to_string())?;
    let duration = modified.duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
    Ok(duration.as_millis() as u64)
}

#[derive(serde::Deserialize)]
struct DroppedFileInfo {
    name: String,
    size: u64,
    last_modified_ms: Option<u64>,
}

#[tauri::command]
fn resolve_dropped_files(files: Vec<DroppedFileInfo>, last_dir: Option<String>) -> Result<Vec<Option<String>>, String> {
    let mut resolved = Vec::new();
    let mut known_dirs: Vec<std::path::PathBuf> = Vec::new();

    if let Some(ref ld) = last_dir {
        let p = std::path::PathBuf::from(ld);
        if p.is_dir() {
            known_dirs.push(p);
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Ok(userprofile) = std::env::var("USERPROFILE") {
            let up = std::path::PathBuf::from(userprofile);
            let desktop = up.join("Desktop");
            if desktop.is_dir() { known_dirs.push(desktop); }
            let downloads = up.join("Downloads");
            if downloads.is_dir() { known_dirs.push(downloads); }
            let docs = up.join("Documents");
            if docs.is_dir() { known_dirs.push(docs); }
        }
    }

    fn path_matches(path: &std::path::Path, info: &DroppedFileInfo) -> bool {
        if !path.is_file() {
            return false;
        }
        if let Ok(meta) = std::fs::metadata(path) {
            if meta.len() != info.size {
                return false;
            }
            if let Some(expected_ms) = info.last_modified_ms {
                if expected_ms > 0 {
                    if let Ok(mod_time) = meta.modified() {
                        if let Ok(duration) = mod_time.duration_since(std::time::UNIX_EPOCH) {
                            let actual_ms = duration.as_millis() as u64;
                            let diff = if actual_ms > expected_ms { actual_ms - expected_ms } else { expected_ms - actual_ms };
                            if diff > 3000 {
                                return false;
                            }
                        }
                    }
                }
            }
            return true;
        }
        false
    }

    fn check_drive_roots(info: &DroppedFileInfo) -> Option<String> {
        #[cfg(target_os = "windows")]
        {
            for drive in b'A'..=b'Z' {
                let candidate = format!("{}:\\{}", drive as char, info.name);
                let p = std::path::Path::new(&candidate);
                if path_matches(p, info) {
                    return Some(candidate);
                }
            }
        }
        None
    }

    fn query_explorer_paths() -> (Vec<std::path::PathBuf>, Vec<std::path::PathBuf>) {
        let mut selected_files = Vec::new();
        let mut folder_paths = Vec::new();

        #[cfg(target_os = "windows")]
        {
            use std::process::Command;
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;

            let script = "$s=(New-Object -ComObject Shell.Application).Windows(); \
                          $s | ForEach-Object { try { $_.Document.SelectedItems() | ForEach-Object { $_.Path } } catch {} }; \
                          $s | ForEach-Object { try { $_.Document.Folder.Self.Path } catch {} }";

            if let Ok(output) = Command::new("powershell")
                .args(["-NoProfile", "-NonInteractive", "-Command", script])
                .creation_flags(CREATE_NO_WINDOW)
                .output()
            {
                if output.status.success() {
                    let text = String::from_utf8_lossy(&output.stdout);
                    for line in text.lines() {
                        let trimmed = line.trim();
                        if !trimmed.is_empty() {
                            let p = std::path::PathBuf::from(trimmed);
                            if p.is_file() {
                                selected_files.push(p);
                            } else if p.is_dir() {
                                folder_paths.push(p);
                            }
                        }
                    }
                }
            }
        }

        (selected_files, folder_paths)
    }

    let mut explorer_queried = false;
    let mut explorer_selected_files = Vec::new();
    let mut explorer_folders = Vec::new();

    for info in &files {
        let mut match_found: Option<String> = None;

        for dir in &known_dirs {
            let candidate = dir.join(&info.name);
            if path_matches(&candidate, info) {
                match_found = Some(candidate.to_string_lossy().to_string());
                break;
            }
        }

        if match_found.is_none() {
            if let Some(drive_root_match) = check_drive_roots(info) {
                let candidate_path = std::path::PathBuf::from(&drive_root_match);
                if let Some(parent) = candidate_path.parent() {
                    if !known_dirs.contains(&parent.to_path_buf()) {
                        known_dirs.insert(0, parent.to_path_buf());
                    }
                }
                match_found = Some(drive_root_match);
            }
        }

        if match_found.is_none() {
            if !explorer_queried {
                let (sel, fld) = query_explorer_paths();
                explorer_selected_files = sel;
                explorer_folders = fld;
                explorer_queried = true;
            }

            for sel_path in &explorer_selected_files {
                if let Some(fname) = sel_path.file_name() {
                    if fname.to_string_lossy().eq_ignore_ascii_case(&info.name) {
                        if path_matches(sel_path, info) {
                            if let Some(parent) = sel_path.parent() {
                                if !known_dirs.contains(&parent.to_path_buf()) {
                                    known_dirs.insert(0, parent.to_path_buf());
                                }
                            }
                            match_found = Some(sel_path.to_string_lossy().to_string());
                            break;
                        }
                    }
                }
            }

            if match_found.is_none() {
                for fld_path in &explorer_folders {
                    let candidate = fld_path.join(&info.name);
                    if path_matches(&candidate, info) {
                        if !known_dirs.contains(fld_path) {
                            known_dirs.insert(0, fld_path.clone());
                        }
                        match_found = Some(candidate.to_string_lossy().to_string());
                        break;
                    }
                }
            }
        }

        resolved.push(match_found);
    }

    Ok(resolved)
}

fn main() {
    #[cfg(target_os = "windows")]
    {
        // Force Chromium/WebView2 engine to render in pure sRGB color space without monitor ICC distortion,
        // and disable HTTP disk caching so local embedded assets are always loaded fresh.
        std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "--force-color-profile=srgb --disable-http-cache");
    }

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            register_file_associations,
            unregister_file_associations,
            check_file_associations,
            open_url,
            read_file_binary,
            write_file_binary,
            pick_open_file,
            pick_save_file,
            get_cli_args,
            force_exit_app,
            read_clipboard_image,
            write_clipboard_image,
            read_clipboard_text,
            write_clipboard_text,
            get_file_modified_time,
            resolve_dropped_files
        ])
        .run(tauri::generate_context!())
        .expect("error while running Advanced SHP Editor");
}

