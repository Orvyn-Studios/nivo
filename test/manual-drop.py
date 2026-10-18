"""Owned manual Explorer fixtures and read-only ZIP verification; never GUI acceptance."""
import argparse
import hashlib
import json
import os
from pathlib import Path
from datetime import datetime, timezone
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def digest(file):
    with file.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def prepare():
    folder = ROOT / 'artifacts' / 'manual-drop' / datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    inputs = folder / 'entrada'
    inputs.mkdir(parents=True, exist_ok=False)
    (inputs / 'diseño-ñ.txt').write_bytes(b'Nivo manual ZIP fixture\n' * 45591)
    (inputs / 'muestra.bin').write_bytes(os.urandom(256 * 1024))
    large = folder / 'cancelar-128MiB.bin'
    with large.open('xb') as stream:
        for _ in range(128):
            stream.write(os.urandom(1024 * 1024))
    manifest = {'createdUtc': datetime.now(timezone.utc).isoformat(), 'folder': str(folder),
                'files': [{'name': p.name, 'path': str(p), 'bytes': p.stat().st_size, 'sha256': digest(p)} for p in sorted(inputs.iterdir())],
                'cancellation': {'path': str(large), 'bytes': large.stat().st_size, 'sha256': digest(large)}}
    manifest_path = folder / 'manifest.json'
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'status': 'fixtures-prepared-only', 'manifest': str(manifest_path), 'explorerFolder': str(inputs),
                      'destination': str(folder / 'resultado.zip'), 'cancellationFile': str(large)}, ensure_ascii=False, indent=2))


def verify(manifest_path, archive_path):
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    expected = {f['name']: f for f in manifest['files']}
    for f in [*manifest['files'], manifest['cancellation']]:
        source = Path(f['path'])
        if source.stat().st_size != f['bytes'] or digest(source) != f['sha256']:
            raise ValueError(f'Original changed: {source.name}')
    with zipfile.ZipFile(archive_path) as archive:
        entries = archive.infolist()
        if len(entries) != len(expected) or {i.filename for i in entries} != set(expected):
            raise ValueError('Unexpected, missing or duplicate ZIP entries')
        for entry in entries:
            f = expected[entry.filename]
            if entry.compress_type != zipfile.ZIP_DEFLATED or entry.file_size != f['bytes']:
                raise ValueError('Unexpected ZIP method or size')
            with archive.open(entry) as stream:
                if hashlib.file_digest(stream, 'sha256').hexdigest() != f['sha256']:
                    raise ValueError('Decompressed ZIP content differs from original')
    report = {'status': 'archive-and-originals-verified', 'archive': str(archive_path.resolve()), 'sha256': digest(archive_path),
              'entries': len(expected), 'limits': 'Read-only ZIP integrity/Deflate/Unicode/source preservation check. Does not prove Explorer drag, GUI progress, cancellation or animation.'}
    print(json.dumps(report, ensure_ascii=False, indent=2))


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('action', choices=['prepare', 'verify'])
parser.add_argument('--manifest', type=Path)
parser.add_argument('--zip', type=Path)
args = parser.parse_args()
if args.action == 'prepare':
    prepare()
elif not args.manifest or not args.zip:
    parser.error('verify requires --manifest and --zip')
else:
    verify(args.manifest, args.zip)
