# Docker Dev Manager

**English** · [Tiếng Việt](README.vi.md)

**Every Docker Compose project on your machine, in one calm dashboard.**

If you have worked with Docker Compose for a while, you have probably met at least one of these:

<table>
<tr>
<td width="50%"><img src="docs/images/pain-port.svg" alt="Terminal: docker compose up fails with Bind for 0.0.0.0:5432 failed: port is already allocated"><br><b>"Port is already allocated"</b>, but by whom?</td>
<td width="50%"><img src="docs/images/pain-restart.svg" alt="Terminal: docker ps shows analytics-api-1 Restarting, its log says clickhouse refused the connection"><br><b>A container keeps restarting</b>, and the reason is buried in logs.</td>
</tr>
<tr>
<td width="50%"><img src="docs/images/pain-memory.svg" alt="Terminal: docker stats with billing-worker-1 at 1.9 GiB, swap at 21850M used of 22528M"><br><b>The Mac crawls and swap is full</b>: which project is eating RAM?</td>
<td width="50%"><img src="docs/images/pain-disk.svg" alt="Terminal: docker system df shows over 50 GB of images, volumes and build cache, and a hesitant docker system prune"><br><b>Docker ate 50+ GB of disk</b>: what is safe to delete?</td>
</tr>
</table>

**Docker Dev Manager puts it all on one screen.** It finds every project by itself, shows at a glance what is running, what is broken and what is eating memory and disk, and lets you fix it in a click. No import, no project file touched.

![Docker Dev Manager overview](docs/images/en-overview.png)

## Get started in a minute

You need:

- **Node.js 20+**
- **Docker Desktop**, or Docker Engine with the `docker compose` v2 plugin, running
- **macOS or Linux**. Opening Finder, Terminal or VS Code and the *Mac memory* card use macOS tools; everything else also works on Linux.

**1. Get the code**

```bash
git clone https://github.com/atdevblog/docker-dev-manager.git
cd docker-dev-manager
```

**2. Start the dashboard**

```bash
npm start
```

There is nothing to install first: the project has no dependencies.

**3. Open http://localhost:4173**

Your projects appear by themselves. Press `Ctrl+C` in the terminal to stop the dashboard.

Need another port? Run `DEV_MANAGER_PORT=4174 npm start`. To keep it running after you close the terminal, use your usual process manager, or `nohup npm start >/tmp/docker-dev-manager.log 2>&1 &`.

<details>
<summary>All settings</summary>

| Variable | Default | Purpose |
|---|---|---|
| `DEV_MANAGER_PORT` | `4173` | Port of the dashboard (always bound to `127.0.0.1`) |
| `DEV_MANAGER_CONFIG_DIR` | `~/.config/docker-dev-manager` | Where settings and the last measurements are saved |
| `DEV_MANAGER_IDLE_MINUTES` | `15` | Minimum gap between two RAM/CPU measurements before a quiet project (no network traffic, CPU < 1%) counts as idle |

</details>

## Explore the user guide

The **[user guide](docs/guide.en.md)** walks through every screen, step by step:

| Start here | Day to day | Keep the machine healthy |
|---|---|---|
| [Install and open](docs/guide.en.md#1-install-and-open) | [Start, stop, restart](docs/guide.en.md#4-start-stop-restart) | [Health & resource advisor](docs/guide.en.md#3-health--resource-advisor) |
| [The screen at a glance](docs/guide.en.md#2-the-screen-at-a-glance) | [One container at a time](docs/guide.en.md#one-container-at-a-time) | [Free up memory](docs/guide.en.md#8-free-up-memory) |
| [Import a project, Up and Down](docs/guide.en.md#11-import-a-project-up-and-down) | [Why is a project not running?](docs/guide.en.md#5-why-is-a-project-not-running) | [Pick free ports](docs/guide.en.md#9-pick-free-ports) |
| [Language](docs/guide.en.md#12-language) | [Read logs](docs/guide.en.md#6-read-logs) | [Clean disk space safely](docs/guide.en.md#10-clean-disk-space-safely) |
| [Questions and problems](docs/guide.en.md#13-questions-and-problems) | [Groups from Docker](docs/guide.en.md#7-groups-from-docker) | |

## What's inside

| | |
|---|---|
| 📊 **Overview at a glance** | Docker health, running projects, container RAM, Mac memory and reclaimable disk on one row, plus charts of containers by state and RAM by project. |
| 🔌 **Ports** | Who holds each host port, which ports stopped projects will need back, and the nearest free ones. |
| 🔁 **Why it is not running** | Crash loops, exit codes in plain words, out-of-memory kills and failed starts, each one click away from the right log, errors only if you like. |
| 🧠 **Free up memory** | Projects sorted by RAM against the Docker VM limit, idle ones spotted between two measurements, and a review of what would break before anything stops. |
| 💾 **Disk cleanup** | Docker's disk use sorted into *safe to clean*, *review first* and *may hold data*, with commands to copy. It never deletes anything itself. |
| 🎛️ **Control at every level** | Start, stop or restart a whole project, a group of projects that share a network (in dependency order) or a single container, like Docker Desktop. Open a shell inside a container, or a Terminal at its folder. |
| 🩺 **Health advisor** | A score made only of explained deductions, and a to-do list ranked **Urgent → Optional** with the RAM or disk each step frees and its risk. |

## Built for everyday use

- ⚡ **Nothing to sign up for**: no database, no account, no cloud. One Node process on your machine, and your data never leaves it.
- 🛡️ **Safe by default**: every action is checked first. A taken port blocks a start, and anything that depends on what you stop is pointed out. Nothing is stopped or deleted automatically.
- 🪶 **Light by default**: about 15 MB of RAM and no CPU at rest. Measurements that cost Docker a few seconds run only when you click their button.
- 🌗 **Comfortable**: light and dark themes, Vietnamese and English. Your choices and the last measurements stay after a reload.

It complements Docker Desktop rather than replacing it.

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

<details>
<summary>Settings file</summary>

Settings are saved in `~/.config/docker-dev-manager/projects.json`. The file is created the first time you save something: an imported project, *keep running*, the language or the theme.

```json
{
  "projects":    [{"name": "billing", "directory": "/Users/you/Projects/billing", "composeFile": "compose.yaml", "description": "Payments service"}],
  "keepRunning": ["infra"],
  "language":    "en",
  "theme":       "dark"
}
```

Writes are atomic with mode `0600`, and keys are preserved. A corrupt file is never overwritten. The last measurements (health check, `docker stats`, `docker system df -v`) are kept next to it in `measurements.json`: they come back with their time after a reload, results older than 7 days are ignored, and the file can be deleted at any time.
</details>

## Development

<details>
<summary>Project layout, tests and how actions run</summary>

```
server.js            HTTP server, Docker CLI calls, preflight checks, background jobs, saved measurements
lib/analysis.js      pure rules: grouping, problems, dependencies, ports, resources, disk, container preflight
lib/advisor.js       health score, waste and ranked recommendations
public/              page (index.html, app.js, style.css), i18n.js, locales/, icons, fonts/
assets/icons/        icon sources; build.sh regenerates favicon.ico and apple-touch-icon.png
docs/                user guides (en, vi) and screenshots
test/                node:test suites
```

- `npm test` runs the unit, HTTP and translation tests. It never changes Docker state and uses a temporary settings folder.
- `npm run test:docker` runs an optional test against the real Docker Engine. It creates throwaway `ddmit*` projects (image `nginx:alpine`, port 47391) and removes them afterwards.
- **Text and languages**: every visible string lives in `public/locales/en.json` and `vi.json`; the server sends `{key, params}` messages, never sentences. Add a key to both files and reference it as a literal (`t('section.key')`, `A.msg('section.key', …)` or `data-i18n="section.key"`). `npm test` fails on missing, unused or mismatched keys.
- **How actions run**:
  - A project's Start, Stop, Restart and Logs use `docker compose -p <name> <command>` from container labels. This needs no Compose file and keeps the `depends_on` order. It runs in an empty folder so Compose cannot pick up another project's file.
  - One container's Start, Stop and Restart use `docker start|stop|restart <id>`: only that container, like Docker Desktop.
  - The container shell opens Terminal with `docker exec -it <container>` (bash when available) through a throwaway `.command` file, so macOS asks for no permission to control Terminal. The folder button opens the host folder of the bind mount behind the container's working directory.
  - Up and Down use the imported project's Compose file.
- **How measurements run**: the page polls only the project list and this Mac's memory, every 15 seconds while it is visible. The health check, `docker stats` and `docker system df -v` each run on their own request; `/api/advisor` only combines the parts already measured and never starts them itself.

</details>

## License

[MIT](LICENSE). Not affiliated with or endorsed by Docker, Inc. Docker is a trademark of Docker, Inc.

The interface uses the [Be Vietnam Pro](https://github.com/bettergui/BeVietnamPro) font, bundled under the [SIL Open Font License 1.1](public/fonts/OFL.txt), and [Lucide](https://lucide.dev) icons under the [ISC license](public/LICENSE-lucide.txt), so the page works offline.
