#!/usr/bin/env python3
"""claude CLI stub for scripts/review/220.sh: one instance's sessions in a state file, every argv
logged. Usage via env: STUB_STATE=<json file> STUB_LOG=<argv log> STUB_NAME=<instance>."""
import json, os, sys, time

state_file, log, name = os.environ['STUB_STATE'], os.environ['STUB_LOG'], os.environ['STUB_NAME']
args = sys.argv[1:]
with open(log, 'a') as f:
    f.write(' '.join(args) + '\n')
with open(state_file) as f:
    sessions = json.load(f)

def save():
    with open(state_file, 'w') as f:
        json.dump(sessions, f)

cmd = args[0] if args else ''
if cmd == '--version':
    print('2.1.318 (Claude Code)')
elif cmd == 'agents':
    print(json.dumps(sessions))
elif cmd == '--bg':
    sid = f'{name}-d{len(sessions)}'
    sessions.append({'kind': 'background', 'id': sid, 'cwd': os.getcwd(), 'name': args[-1],
                     'state': 'working', 'startedAt': int(time.time() * 1000)})
    save()
    print(f'backgrounded · {sid} · {args[-1]}')
elif cmd in ('stop', 'respawn'):
    for s in sessions:
        if s['id'] == args[1]:
            s['state'] = 'stopped' if cmd == 'stop' else 'working'
    save()
    print(f'{cmd} {args[1]}')
elif cmd == 'logs':
    print(f'log of {args[1]} on {name}')
elif cmd == 'attach':
    print(f'attached {args[1]} on {name}', flush=True)
    for line in sys.stdin:  # proves terminal input reaches this PTY
        print(f'{name} got: {line.strip()}', flush=True)
elif cmd == '-p':
    sid = f'{name}-chat'
    print(json.dumps({'type': 'system', 'subtype': 'init', 'session_id': sid}), flush=True)
    for line in sys.stdin:
        try:
            msg = json.loads(line)
        except ValueError:
            continue
        if msg.get('type') != 'user':
            continue
        text = f'pong from {name}'
        print(json.dumps({'type': 'assistant', 'session_id': sid,
                          'message': {'role': 'assistant', 'content': [{'type': 'text', 'text': text}]}}), flush=True)
        print(json.dumps({'type': 'result', 'subtype': 'success', 'result': text, 'session_id': sid}), flush=True)
