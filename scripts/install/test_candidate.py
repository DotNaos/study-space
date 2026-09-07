#!/usr/bin/env python3
"""Native setup failure proof on the configured host; all mutation commands are stubbed."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

BINARY = os.environ.get("STUDY_TEST_BINARY", str(Path(__file__).resolve().parents[2] / "cli/target/release/study"))
PROXY = Path('/etc/dotnaos/systems-machine-proxy/traefik.yml')


@unittest.skipUnless(PROXY.is_file(), 'requires the existing Systems proxy for read-only prerequisite checks')
class CandidateTests(unittest.TestCase):
    def test_failed_build_preserves_running_release_and_config(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            home = root / 'home'
            old = home / 'releases/0.1.0'
            old.mkdir(parents=True)
            (home / 'current').symlink_to(old)
            config = json.dumps({'version': '0.1.0', 'schema_version': 1, 'public_url': 'https://study.os-pc.vpn.os-home.net', 'port': 18081, 'release_base': 'https://example.test'})
            (home / 'installation.json').write_text(config)
            (home / 'install.env').write_text('unchanged-environment\n')
            (old / 'running-marker').write_text('old-running-app')
            bundle = root / 'bundle'
            (bundle / 'source/server').mkdir(parents=True)
            (bundle / 'source/web').mkdir()
            for file in ['compose.yaml', 'source/Dockerfile', 'source/.dockerignore']:
                (bundle / file).write_text('# fixture\n')
            commit = '1' * 40
            (bundle / 'release.env').write_text(f'STUDY_IMAGE=study-space-local:v0.1.1-{commit}\nSTUDY_VERSION=v0.1.1\nSTUDY_COMMIT={commit}\nSTUDY_SCHEMA_VERSION=1\n')
            mock = root / 'mock'
            mock.mkdir()
            proxy_ip = next(line.split('"')[1].split(':')[0] for line in PROXY.read_text().splitlines() if ':443"' in line)
            commands = {
                'tailscale': '#!/bin/sh\necho ' + proxy_ip + '\n',
                'curl': '#!/bin/sh\nexit 0\n',
                'sudo': '''#!/usr/bin/env python3
import os,sys
from pathlib import Path
args=sys.argv[1:]
assert args[0]=='--'
args=args[1:]
p=Path(args[-1])
assert p.is_relative_to(Path(os.environ['TEST_ROOT'])), 'forbidden machine mutation'
if args[0]=='install': p.mkdir(parents=True,exist_ok=True)
elif args[0]!='chown': sys.exit(99)
''',
                'docker': '''#!/usr/bin/env python3
import json,os,sys
from pathlib import Path
args=sys.argv[1:]
with open(os.environ['TEST_LOG'],'a') as log: log.write(json.dumps(args)+'\\n')
if args[0]=='inspect': print(json.dumps({'State':{'Running':True},'HostConfig':{'NetworkMode':'host'}}))
elif args[-2:]==['build','app']:
    home=Path(os.environ['TEST_ROOT'])/'home'
    assert (home/'current').resolve().name=='0.1.0'
    assert (home/'install.env').read_text()=='unchanged-environment\\n'
    assert json.loads((home/'installation.json').read_text())['version']=='0.1.0'
    assert 'STUDY_IMAGE' not in os.environ
    sys.exit(42)
elif 'up' in args: sys.exit(98)
'''
            }
            for name, content in commands.items():
                path = mock / name
                path.write_text(content)
                path.chmod(0o755)
            log = root / 'commands'
            result = subprocess.run([BINARY, '--home', str(home), 'setup', '--bundle', str(bundle), '--version', '0.1.1'],
                env={**os.environ, 'PATH': f'{mock}:{os.environ["PATH"]}', 'TEST_ROOT': str(root), 'TEST_LOG': str(log), 'STUDY_IMAGE': 'must-not-override-release'},
                text=True, capture_output=True, timeout=20)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('candidate image build failed', result.stderr)
            self.assertEqual((home / 'current').resolve(), old)
            self.assertEqual((home / 'installation.json').read_text(), config)
            self.assertEqual((home / 'install.env').read_text(), 'unchanged-environment\n')
            self.assertEqual((old / 'running-marker').read_text(), 'old-running-app')
            calls = [json.loads(line) for line in log.read_text().splitlines()]
            self.assertTrue(any(call[-2:] == ['build', 'app'] for call in calls))
            self.assertFalse(any('up' in call or 'pull' in call for call in calls))


if __name__ == '__main__':
    unittest.main(verbosity=2)
