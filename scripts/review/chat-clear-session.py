# Does a Claude Code session id change on /clear? Usage: python3 scripts/review/chat-clear-session.py <empty dir>
import sys, os, pty, time, uuid, json, select, glob
sid = str(uuid.uuid4()); pid, fd = pty.fork()
if pid == 0:
    os.chdir(sys.argv[1]); [os.environ.pop(k) for k in list(os.environ) if k.startswith('CLAUDE')]
    os.execvp('claude', ['claude', '--session-id', sid, '--model', 'haiku'])
def pump(s):
    end = time.time() + s
    while time.time() < end:
        if select.select([fd], [], [], 0.2)[0]:
            try: os.read(fd, 65536)
            except OSError: return
def state(label):
    try: live = json.load(open(os.path.expanduser(f'~/.claude/sessions/{pid}.json')))['sessionId']
    except Exception as e: live = f'n/a {e}'
    files = sorted(os.path.basename(f) for f in glob.glob(os.path.expanduser('~/.claude/projects/*/*.jsonl')))
    import subprocess; out=subprocess.run(['claude','agents','--json','--all'],capture_output=True,text=True).stdout
    try: ag=[e.get('sessionId','')[:8] for e in json.loads(out) if e.get('pid')==pid]
    except Exception as e: ag=f'err {e} {out[:200]}'
    print(label, 'agents', ag, 'started', sid[:8], 'live', live[:8], 'files', [f[:8] for f in files], flush=True)
pump(8); os.write(fd, b'\r'); pump(4)
os.write(fd, b'Antworte nur: ok'); time.sleep(0.3); os.write(fd, b'\r'); pump(12); state('before /clear')
os.write(fd, b'/clear'); time.sleep(0.5); os.write(fd, b'\r'); pump(5); state('after /clear')
os.write(fd, b'Antworte nur: zwei'); time.sleep(0.3); os.write(fd, b'\r'); pump(12); state('after prompt')
os.kill(pid, 9)
