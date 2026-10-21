use super::*;
use std::io::Write;

fn archive(files: &[(&str, &str)]) -> Vec<u8> {
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    for (name, content) in files {
        zip.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
        zip.write_all(content.as_bytes()).unwrap();
    }
    zip.finish().unwrap().into_inner()
}

#[test]
fn root_and_wrapped_text_skills_preserve_resources() {
    for prefix in ["", "my-skill/"] {
        let names = [format!("{prefix}SKILL.md"), format!("{prefix}references/example.md")];
        let package = inspect(&archive(&[(&names[0], "# A writing guide"), (&names[1], "Real reference")])).unwrap();
        assert_eq!(package.compatibility, "text");
        assert_eq!(package.files[1], ("references/example.md".into(), b"Real reference".to_vec()));
        assert_eq!(package.sha256.len(), 64);
    }
}

#[test]
fn dependency_classification_is_conservative() {
    for (path, contents, expected) in [
        ("scripts/main.py", "print('hello')", "python"),
        ("scripts/main.js", "const fs = require('fs')", "node"),
        ("package.json", "{}", "node"),
        ("run.sh", "echo hi", "native"),
        ("README.md", "npx clawhub install example", "installer"),
        ("README.md", "Requires localhost:8002 service", "external-service"),
    ] {
        let package = inspect(&archive(&[("SKILL.md", "# Example"), (path, contents)])).unwrap();
        assert_eq!(package.compatibility, "external-agent");
        assert!(package.requirements.contains(&expected.to_string()));
    }
    let package = inspect(&archive(&[("SKILL.md", "# Sum"), ("sum.js", "function main(input){return input.reduce((a,b)=>a+b,0)}")])).unwrap();
    assert_eq!(package.compatibility, "javascript");
}

#[test]
fn reject_paths_duplicates_and_ambiguous_roots() {
    for path in ["../evil", "/absolute", "C:/absolute", "dir/../evil", "a\\b", "a:stream", "CON", "a. "] {
        assert!(inspect(&archive(&[("SKILL.md", "guide"), (path, "bad")])).is_err(), "{path}");
    }
    for files in [
        vec![("SKILL.md", "guide"), ("skill.md", "duplicate")],
        vec![("one/SKILL.md", "guide"), ("two/SKILL.md", "ambiguous")],
        vec![("one/SKILL.md", "guide"), ("outside.txt", "outside")],
        vec![("README.md", "no entry")],
    ] { assert!(inspect(&archive(&files)).is_err()); }
}

#[test]
fn rejects_links_bombs_and_oversized_input() {
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    zip.start_file("SKILL.md", zip::write::SimpleFileOptions::default()).unwrap();
    zip.write_all(b"# Guide").unwrap();
    zip.add_symlink("link", "/etc/passwd", zip::write::SimpleFileOptions::default()).unwrap();
    assert!(inspect(&zip.finish().unwrap().into_inner()).is_err());
    assert!(inspect(&vec![0; MAX_ZIP + 1]).is_err());
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    zip.start_file("SKILL.md", zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated)).unwrap();
    zip.write_all(&vec![b'x'; MAX_TEXT]).unwrap();
    assert!(inspect(&zip.finish().unwrap().into_inner()).is_err());
}

#[test]
fn preserves_original_bytes_and_does_not_execute() {
    let script = "throw new Error('must never execute during inspect')";
    let package = inspect(&archive(&[("SKILL.md", "# JS"), ("script.js", script)])).unwrap();
    assert_eq!(package.files[1].1, script.as_bytes());
}
