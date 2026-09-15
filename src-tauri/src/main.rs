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

            // 1. HKCU\Software\Classes\.ext -> prog_id
            let (ext_key, _) = classes.create_subkey(format!(".{}", clean_ext))
                .map_err(|e| format!("Failed to create .{} subkey: {}", clean_ext, e))?;
            ext_key.set_value("", &prog_id)
                .map_err(|e| format!("Failed to set default value for .{}: {}", clean_ext, e))?;

            // 2. HKCU\Software\Classes\prog_id
            let (prog_key, _) = classes.create_subkey(&prog_id)
                .map_err(|e| format!("Failed to create prog_id {}: {}", prog_id, e))?;
            let desc = format!("Command & Conquer {} File", clean_ext.to_uppercase());
            let _ = prog_key.set_value("", &desc);

            // 3. DefaultIcon -> "{exe_path}",0
            if let Ok((icon_key, _)) = prog_key.create_subkey("DefaultIcon") {
                let _ = icon_key.set_value("", &format!("\"{}\",0", exe_path));
            }

            // 4. shell\open\command -> "{exe_path}" "%1"
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
            open_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running Advanced SHP Editor");
}

