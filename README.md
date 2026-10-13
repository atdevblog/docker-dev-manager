# Docker Dev Manager

**English** · [Tiếng Việt](README.vi.md)

A local web dashboard for the Docker Compose projects on your computer. It finds every project automatically, scores Docker's health and tells you what to fix first, starts and stops projects (one by one or in groups), explains why a project is not running, and helps you free memory, pick free ports and clean disk space safely. It complements Docker Desktop rather than replacing it.

![Docker Dev Manager](docs/images/en-overview.png)

- **Zero setup**: Node.js only, no npm dependencies, no database.
- **Works with existing projects**: discovered from Docker labels, with no import step and no files moved.
- **Safe by default**: every action is checked first; nothing is deleted or stopped automatically.
- **Vietnamese / English** interface.

📖 **[User guide](docs/guide.en.md)** · [Hướng dẫn sử dụng](docs/guide.vi.md)

## Requirements

- Node.js **20 or newer**
- Docker Desktop, or Docker Engine with the `docker compose` v2 plugin, running
- macOS or Linux. Opening folders in Finder/Terminal/VS Code and the "This Mac" memory card use macOS tools; everything else works on Linux.

## Install and run

```bash
git clone https://github.com/atdevblog/docker-dev-manager.git
cd docker-dev-manager
npm start
```

Open **http://localhost:4173**. Stop it with `Ctrl+C`.

| Variable | Default | Purpose |
|---|---|---|
| `DEV_MANAGER_PORT` | `4173` | Port of the dashboard (always bound to `127.0.0.1`) |
| `DEV_MANAGER_CONFIG_DIR` | `~/.config/docker-dev-manager` | Where settings are saved |
| `DEV_MANAGER_IDLE_MINUTES` | `15` | How long a running project must stay quiet (no network traffic, CPU < 1%) before the advisor calls it idle |

Example: `DEV_MANAGER_PORT=4174 npm start`. To keep it running after closing the terminal, use your usual process manager, or `nohup npm start >/tmp/docker-dev-manager.log 2>&1 &`.

## What you can do

| | |
|---|---|
| **Overview at a glance** | Five tiles at the top: Docker health score, running projects, RAM used by containers against the Docker VM limit, this Mac's memory with pressure and swap, and the disk space that can be reclaimed. Click a tile to jump to its details. |
| **Health & resource advisor** | Three columns answer *what is wrong*, *where resources are wasted* and *what to do now*. The health score is made only of explained deductions. Actions are ranked **Urgent → Important → Recommended → Optional**, most serious first, each with estimated RAM/disk gain and risk. |
| **Projects** | See every Compose project with its status, RAM and problems. Start, stop, restart and read logs without importing anything. |
| **Why it is not running** | Crash loops, exit codes in plain words, out-of-memory kills, unhealthy containers and failed starts, each with a one-click log. |
| **Safe actions** | Checks before running: ports taken by another container block the start, and projects that depend on each other through a shared network are pointed out. |
| **Groups from Docker** | When a project joins another project's network (an app and its database or proxy stack), they form a group automatically. Start or stop the group in one click, in dependency order, with a review first. |
| **Free up memory** | Running projects sorted by memory, with notes on what stopping them would break. Shared infrastructure can be marked *keep running*. |
| **Ports** | Which host ports are taken, which are reserved by stopped projects, and the nearest free ones. |
| **Disk** | What Docker uses on disk, classified *safe to clean*, *review first* or *may hold data*, with copyable commands. The dashboard deletes nothing itself. |

## Screenshots

![Health & resource advisor](docs/images/en-advisor.png)

<table>
<tr>
<td width="50%"><b>Projects and groups from Docker</b><br><img src="docs/images/en-projects.png" alt="Project cards with problems and groups"></td>
<td width="50%"><b>Free up memory</b><br><img src="docs/images/en-memory.png" alt="Running projects sorted by memory"></td>
</tr>
<tr>
<td width="50%"><b>Ports</b><br><img src="docs/images/en-ports.png" alt="Ports taken, reserved and free"></td>
<td width="50%"><b>Disk</b><br><img src="docs/images/en-disk.png" alt="Disk usage classified by risk"></td>
</tr>
</table>

The [user guide](docs/guide.en.md) walks through each screen in detail.

## Settings file

Settings are saved in `~/.config/docker-dev-manager/projects.json`. The file is created the first time you save something: an imported project, *keep running* or the language.

```json
{
  "projects":    [{"name": "billing", "directory": "/Users/you/Projects/billing", "composeFile": "compose.yaml", "description": "Payments service"}],
  "keepRunning": ["infra"],
  "language":    "en"
}
```

Writes are atomic with mode `0600`, and keys are preserved. A corrupt file is never overwritten.

## Security

This is a **single-user local tool**. It listens on `127.0.0.1` only, rejects requests whose `Host` is not `localhost`, and requires a per-session token and a localhost `Origin` for every change. Commands run with your own Docker permissions. Do not expose it on a network or through a tunnel.

<details>
<summary>Optional: open it with a local domain through a reverse proxy</summary>

A proxy on the same computer, itself bound to `127.0.0.1`, works if it rewrites `Host` and `Origin` to localhost. Example for nginx:

```nginx
map $http_origin $ddm_origin { default $http_origin; "~^https?://docker-dev\.localhost$" "http://localhost:4173"; }
server {
    listen 127.0.0.1:80;
    server_name docker-dev.localhost;
    location / {
        proxy_pass http://127.0.0.1:4173;
        proxy_set_header Host localhost:4173;
        proxy_set_header Origin $ddm_origin;
        proxy_read_timeout 180s;
    }
}
```
</details>

## Troubleshooting

| Problem | Fix |
|---|---|
| *Unable to connect to Docker Engine* | Start Docker Desktop, then click **Refresh**. |
| A project is not listed | Only projects that still have containers are discovered. Click **Scan Docker**, or **Add manually**. |
| `EADDRINUSE` on start | Port 4173 is taken: `DEV_MANAGER_PORT=4174 npm start`. |
| No CPU/RAM figures | Check that `docker stats --no-stream` works in a terminal. |

## Development

```
server.js            HTTP server, Docker CLI calls, preflight checks, background jobs
lib/analysis.js      pure rules: grouping, problems, dependencies, ports, resources, disk
lib/advisor.js       health score, waste and ranked recommendations
public/              page (index.html, app.js, style.css), i18n.js, locales/, icons
assets/icons/        icon sources; build.sh regenerates favicon.ico and apple-touch-icon.png
docs/                user guides (en, vi) and screenshots
test/                node:test suites
```

- `npm test` runs the unit, HTTP and translation tests. It never changes Docker state and uses a temporary settings folder.
- `npm run test:docker` runs an optional test against the real Docker Engine. It creates throwaway `ddmit*` projects (image `nginx:alpine`, port 47391) and removes them afterwards.
- **Text and languages**: every visible string lives in `public/locales/en.json` and `vi.json`; the server sends `{key, params}` messages, never sentences. Add a key to both files and reference it as a literal (`t('section.key')`, `A.msg('section.key', …)` or `data-i18n="section.key"`). `npm test` fails on missing, unused or mismatched keys.
- **How actions run**:
  - Start, Stop, Restart and Logs use `docker compose -p <name> <command>` from container labels. This needs no Compose file and keeps the `depends_on` order. It runs in an empty folder so Compose cannot pick up another project's file.
  - Up and Down use the imported project's Compose file.

## License

[MIT](LICENSE). Not affiliated with or endorsed by Docker, Inc. Docker is a trademark of Docker, Inc.
