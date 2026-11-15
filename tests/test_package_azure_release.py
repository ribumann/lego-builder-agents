import json
from pathlib import Path
import sys
import subprocess
import tempfile
import unittest
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.package_azure_release import (
    PackageError,
    build_package,
    collect_runtime_files,
    verify_git_source,
)


class PackageAzureReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name) / "source"
        self.root.mkdir()
        for name, content in (
            ("package.json", json.dumps({"dependencies": {"@huggingface/transformers": "3.8.1"}})),
            ("server.mjs", "import './src/windows-copilot-job-runner.mjs';\n"),
            ("planning.mjs", "export const ready = true;\n"),
            ("src/windows-copilot-job-runner.mjs", "import '../planning.mjs';\n"),
            ("src/custom-design.mjs", "export const prompt = 'ok';\n"),
            ("scripts/windows-copilot-job-host.ps1", "Write-Output 'ok'\n"),
            ("dist/assets/voice-worker.mjs", "export {};\n"),
            ("dist/assets/runtime.wasm", "wasm"),
            ("node_modules/@huggingface/transformers/package.json", '{"version":"3.8.1"}'),
            ("node_modules/@huggingface/transformers/index.mjs", "export {};\n"),
        ):
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")
        (self.root / ".env").write_text("never package", encoding="utf-8")
        (self.root / "tests").mkdir()
        (self.root / "tests" / "secret-fixture.txt").write_text("not runtime", encoding="utf-8")

    def tearDown(self):
        self.temporary.cleanup()

    def test_release_contains_runtime_import_closure_worker_assets_and_manifest_only(self):
        files = {path.as_posix() for path in collect_runtime_files(self.root, verify_npm=False)}
        self.assertIn("src/windows-copilot-job-runner.mjs", files)
        self.assertIn("scripts/windows-copilot-job-host.ps1", files)
        self.assertIn("dist/assets/voice-worker.mjs", files)
        self.assertIn("dist/assets/runtime.wasm", files)
        self.assertIn("node_modules/@huggingface/transformers/index.mjs", files)
        self.assertNotIn(".env", files)
        self.assertNotIn("tests/secret-fixture.txt", files)

    def test_missing_local_module_fails_closed(self):
        (self.root / "src" / "windows-copilot-job-runner.mjs").write_text(
            "import './missing-runtime.mjs';\n", encoding="utf-8"
        )
        with self.assertRaisesRegex(PackageError, "Unresolved local runtime import"):
            collect_runtime_files(self.root, verify_npm=False)

    def test_build_writes_manifest_hash_and_refuses_overwrite(self):
        output = Path(self.temporary.name) / "release.zip"
        result = build_package(
            self.root,
            "b" * 40,
            output,
            verify_npm=False,
        )
        self.assertEqual(result["revision"], "b" * 40)
        with zipfile.ZipFile(output) as archive:
            manifest = json.loads(archive.read("release-manifest.json"))
            names = set(archive.namelist())
        self.assertEqual(manifest["revision"], "b" * 40)
        self.assertIn("src/windows-copilot-job-runner.mjs", names)
        self.assertIn("dist/assets/runtime.wasm", names)
        second = Path(self.temporary.name) / "release-second.zip"
        second_result = build_package(self.root, "b" * 40, second, verify_npm=False)
        self.assertEqual(result["sha256"], second_result["sha256"])
        existing_contents = output.read_bytes()
        with self.assertRaisesRegex(PackageError, "Refusing to overwrite"):
            build_package(self.root, "b" * 40, output, verify_npm=False)
        self.assertEqual(output.read_bytes(), existing_contents)

    def test_output_must_be_outside_release_source(self):
        with self.assertRaisesRegex(PackageError, "outside the repository"):
            build_package(
                self.root,
                "b" * 40,
                self.root / "release.zip",
                verify_npm=False,
            )

    def test_requires_full_revision(self):
        with self.assertRaisesRegex(PackageError, "full lowercase"):
            build_package(
                self.root,
                "b359196",
                Path(self.temporary.name) / "release.zip",
                verify_npm=False,
            )

    def test_cli_source_verification_requires_exact_clean_commit(self):
        repository = Path(self.temporary.name) / "git-source"
        repository.mkdir()
        subprocess.run(["git", "init"], cwd=repository, check=True, capture_output=True)
        subprocess.run(["git", "config", "user.email", "test@example.invalid"], cwd=repository, check=True)
        subprocess.run(["git", "config", "user.name", "Release Test"], cwd=repository, check=True)
        (repository / "source.txt").write_text("candidate", encoding="utf-8")
        subprocess.run(["git", "add", "source.txt"], cwd=repository, check=True)
        subprocess.run(["git", "commit", "-m", "test source"], cwd=repository, check=True, capture_output=True)
        revision = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=repository, check=True, capture_output=True, text=True
        ).stdout.strip()
        verify_git_source(repository, revision)
        with self.assertRaisesRegex(PackageError, "does not match"):
            verify_git_source(repository, "b" * 40)
        (repository / "untracked.txt").write_text("dirty", encoding="utf-8")
        with self.assertRaisesRegex(PackageError, "dirty source tree"):
            verify_git_source(repository, revision)


if __name__ == "__main__":
    unittest.main()
