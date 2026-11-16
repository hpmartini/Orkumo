# When do prompts reach a Claude Code transcript? Starts a throwaway session (haiku) in a PTY,
# sends one prompt while idle and one while a turn runs, prints each new transcript line with
# the seconds since start. Usage: python3 scripts/review/chat-queue-timing.py <empty dir>
import os, pty, time, uuid, json, glob, select, sys
sid = str(uuid.uuid4()); cwd = sys.argv[1] if len(sys.argv) > 1 else os.getcwd()
pid, fd = pty.fork()
if pid == 0:
    os.chdir(cwd); [os.environ.pop(k) for k in list(os.environ) if k.startswith('CLAUDE')]; os.execvp('claude', ['claude', '--session-id', sid, '--model', 'haiku'])
t0 = time.time(); seen = 0
def pump(sec):
    global seen
    end = time.time() + sec
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.2)
        if r:
            try: os.read(fd, 65536)
            except OSError: return
        for f in glob.glob(os.path.expanduser('~/.claude/projects/*/' + sid + '.jsonl')):
            lines = open(f).read().splitlines()
            for l in lines[seen:]:
                rec = json.loads(l); m = rec.get('message') or {}
                c = rec.get('content') or (m.get('content') if isinstance(m.get('content'), str) else '') or (rec.get('attachment') or {}).get('prompt', '')
                print(f'{time.time()-t0:6.1f}s', rec.get('type'), rec.get('operation') or (rec.get('attachment') or {}).get('type') or m.get('role') or rec.get('subtype'), repr(str(c)[:30]), flush=True)
            seen = len(lines)
def send(text, label):
    print(f'{time.time()-t0:6.1f}s >>> SEND {label}', flush=True)
    os.write(fd, b'\x1b[200~' + text.encode() + b'\x1b[201~'); time.sleep(0.3); os.write(fd, b'\r')
pump(8); os.write(fd, b'\r'); pump(5)   # trust dialog
send('Antworte nur mit: ok', 'idle'); pump(15)
send('Fuehre mit Bash aus: sleep 20 && echo fertig. Dann antworte nur: erledigt', 'long'); pump(5)
send('Zweiter Prompt waehrend des Laufs: antworte nur mit zwei', 'busy'); pump(45)
os.kill(pid, 9)
