"""Deployment control-flow tests: fake executables, no SSH/network/deploy."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]

class DeploymentSafety(unittest.TestCase):
    def run_deploy(self, target, status="200", approved=True):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            trace = directory / "trace"
            stub = '''#!/usr/bin/env python3
import os,sys,json
from pathlib import Path
name=Path(sys.argv[0]).name
with open(Path(sys.argv[0]).parent / 'trace','a') as f: f.write(json.dumps([name,sys.argv[1:]])+'\\n')
if name=='ssh':
 command=sys.argv[-1]
 if 'tr -dc' in command: print('0')
 if 'test ' in command and 'curl --max-time' in command and os.environ['HTTP_STATUS']!='200': sys.exit(1)
if name=='curl': print(os.environ['HTTP_STATUS'],end='')
'''
            for name in ["ssh", "rsync", "npm", "npx", "curl", "sleep"]:
                p = directory / name
                p.write_text(stub)
                p.chmod(0o755)
            env = dict(os.environ, PATH=f"{tmp}:{os.environ['PATH']}", TRACE=str(trace), HTTP_STATUS=status)
            env.pop("GETVOXLY_RELEASE_APPROVED", None)
            env.pop("GETVOXLY_RESTORE_VERIFIED", None)
            if approved:
                env.update(GETVOXLY_RELEASE_APPROVED="yes", GETVOXLY_RESTORE_VERIFIED="isolated-test")
            result = subprocess.run(["sh", str(ROOT / "scripts/deploy.sh"), target], env=env, text=True, capture_output=True, timeout=20)
            return result, trace.read_text() if trace.exists() else ""

    def test_no_deploy_without_gate(self):
        result, trace = self.run_deploy("frontend", approved=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(trace, "")

    def test_rejects_invalid_target(self):
        result, trace = self.run_deploy("frontend; touch /tmp/invalid")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(trace, "")

    def test_frontend_does_not_restart_backend(self):
        result, trace = self.run_deploy("frontend")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("--force-recreate frontend", trace)
        self.assertNotIn("--force-recreate backend", trace)
        self.assertNotIn("docker-compose stop", trace)
        self.assertIn('"test", "--", "--maxWorkers=2"', trace)
        self.assertLess(trace.index("pg_dump"), trace.index('"rsync"'))

    def test_audit_secrets_excluded(self):
        result, trace = self.run_deploy("backend")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('".audit"', trace)
        self.assertIn('"scripts/audit-*"', trace)
        self.assertIn('".env.*"', trace)
        self.assertIn("--force-recreate backend", trace)

    def test_non_200_fails_release(self):
        result, _ = self.run_deploy("frontend", status="503")
        self.assertNotEqual(result.returncode, 0)

if __name__ == "__main__":
    unittest.main()
