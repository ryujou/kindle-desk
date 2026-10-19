"""Read the desktop's observed pet selection for the locally signed-in account."""
import json
from pathlib import Path


def selection(home, manifest):
    home = Path(home)
    try:
        # Only the account identifier is used; no credentials leave this process.
        account = json.loads((home / 'auth.json').read_text(encoding='utf-8')).get('tokens', {}).get('account_id')
        atoms = json.loads((home / '.codex-global-state.json').read_text(encoding='utf-8')).get('electron-persisted-atom-state', {})
    except (OSError, ValueError):
        return {'state': 'unavailable'}
    if not account:
        return {'state': 'unavailable'}
    matches = [pet for key, pet in atoms.get('last-observed-cloud-pet-selection-v1', {}).items()
               if json.loads(key)[0] == account]
    if len(matches) != 1:
        return {'state': 'unavailable'}
    pet_id = matches[0]
    if pet_id in ('default', None):
        return {'state': 'off'}
    if pet_id not in manifest:
        return {'state': 'missing_asset', 'id': pet_id}
    return dict(manifest[pet_id], state='ready', id=pet_id)
