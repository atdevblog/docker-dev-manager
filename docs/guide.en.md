# Docker Dev Manager — User guide

**English** · [Tiếng Việt](guide.vi.md) · [Back to README](../README.md)

Docker Dev Manager is a local web page for the Docker Compose projects on your computer. It finds them automatically, starts and stops them, explains why one is not running, and helps you free memory, pick free ports and clean disk space safely.

> Screenshots use demo data.

## Contents

1. [Install and open](#1-install-and-open)
2. [The screen at a glance](#2-the-screen-at-a-glance)
3. [Health & resource advisor](#3-health--resource-advisor)
4. [Start, stop, restart](#4-start-stop-restart)
5. [Why is a project not running?](#5-why-is-a-project-not-running)
6. [Read logs](#6-read-logs)
7. [Groups from Docker](#7-groups-from-docker)
8. [Free up memory](#8-free-up-memory)
9. [Pick free ports](#9-pick-free-ports)
10. [Clean disk space safely](#10-clean-disk-space-safely)
11. [Import a project, Up and Down](#11-import-a-project-up-and-down)
12. [Language](#12-language)
13. [Questions and problems](#13-questions-and-problems)
14. [Bitbucket: move Git over SSH to ssh.bitbucket.org](#14-bitbucket-move-git-over-ssh-to-sshbitbucketorg)

## 1. Install and open

You need **Node.js 20+** and **Docker Desktop** (or Docker Engine with `docker compose` v2) running.

```bash
git clone https://github.com/atdevblog/docker-dev-manager.git
cd docker-dev-manager
npm start
```

There is nothing to install: the project has no npm dependencies. Open **http://localhost:4173**. Keep the terminal open while you use it; press `Ctrl+C` to stop. On Windows, run these in PowerShell with Docker Desktop started. To use another port: `DEV_MANAGER_PORT=4174 npm start` (PowerShell: `$env:DEV_MANAGER_PORT=4174; npm start`).

## 2. The screen at a glance

![Overview](images/en-overview.png)

- **Sidebar**, in three groups with one page each: *Explore* (**Overview**, **Projects**, **Containers**), *Understand* (**Health**, **Resources**, **Ports**) and *Maintain* (**Cleanup**). Near the bottom, *This Mac* (*This computer* on Windows and Linux) shows the drive of your home folder, used of total with what is free, and the network traffic now: download ↓ and upload ↑ per second, averaged since the previous reading. It is the traffic flowing, not a speed test; hover either line for details. **Check network** times a connection to Docker Hub and Cloudflare (about a second, nothing downloaded) and rates it: *Fast* under 50 ms, *OK* up to 150 ms, *Slow* above, *Offline* when neither answers. The rating follows the quicker of the two; hover it to see each one, for example a slow Docker Hub that makes image pulls drag. The dot at the bottom shows whether Docker Engine is reachable, and the button next to it folds the sidebar to icons. Every page has its own address (`#projects`, `#containers`…), so a reload stays where you were.
- **Top bar**: where you are, the language (*Tiếng Việt / English*), the light/dark theme switch, **Refresh**, and **Add manually** for a project that has no containers yet. The theme follows macOS until you pick one; the choice is saved with the language.
- **Overview** says what is happening now:
  - Five cards (click one to open its page):
    - *Docker health*: the score out of 100 with its status (Healthy, Needs attention, Unhealthy), the number of problems and when it was checked. It says *Not checked* until you click **Check** on the card (about half a second). It turns red when Docker Engine is unreachable.
    - *Running projects*: running out of total, with the number of containers and of projects that need attention.
    - *Container RAM*: memory used by containers against the Docker Desktop VM size (with a meter), CPU in cores, and the largest project. It needs `docker stats` (about 2 seconds of Docker work), so it says *Not measured* until you click **Measure** on the card.
    - *Mac memory*: memory used (counted like Activity Monitor) against the total, with a meter whose colour follows macOS memory pressure, plus swap and CPU. Heavy swap is highlighted when memory is short. On Windows and Linux the card is called *Computer memory* and shows memory in use and CPU, without memory pressure.
    - *Reclaimable disk*: what can be cleaned safely, plus what needs review first. Click **Analyze** on the card (`docker system df -v`, a few seconds).
  - **Containers by project**: one bar per project, as long as its number of containers and split by state (running, unhealthy or paused, failed or restarting, stopped), with *running / total* at the end. Hover a bar for the counts, click a name for its details, **View table** opens the Containers page.
  - **RAM by project**: projects sorted by memory, with their share of the Docker VM, from the last *Container RAM* measurement. Containers without a project are grouped as *Standalone containers*.
  - **Needs attention**: the problems your projects report, errors first, each with its project and a **Log** button.
  - **Projects**: the first projects with their status and RAM; click a name for its details, **View all** for the rest. Every block folds from its title, and the choice is remembered.
- **Projects**: filters (All, Running, *Needs attention*, Managed, Discovered), a search box, the [groups from Docker](#7-groups-from-docker) with ▶ start and ■ stop, and one card per Compose project:
  - Click the project's **name** to open its details, in a panel from the right. Hovering the name shows whether it was *Discovered* (found automatically) or *Managed* (imported or added by you, needed only for Up/Down), and its folder.
  - Status: *Running*, *Partly running* or *Stopped*.
  - One line under the name tells the most useful thing: the most serious problem (with **Log** and **+N more**), otherwise the description, otherwise the folder. Tags follow it: *Managed*, `N sources` (the same project name was started from several folders or file sets) and ★ *Keep running* (shared infrastructure you never want to stop by accident).
  - The **container bar** shows *running / total*, RAM once measured, and each container's state in colour; hover it for the counts.
  - The buttons: the next step in words (**▶ Start**, or **■ Stop** when everything runs), then quiet icons with a tooltip for Stop, Restart, Logs, Terminal and Details, shown only when they can do something.

![Project cards](images/en-projects.png)

Click a card's **container bar** to open one row per container with its own buttons (see [One container at a time](#one-container-at-a-time)).

- **Containers**: every container of every project in one table, with its state, CPU · RAM (once measured), ports, uptime and the same buttons as on the cards. Filter by Running, Stopped or Problems, or search by name, project, image or port. Problems come first.

The project list and *Mac memory* refresh every 15 seconds while the page is visible: they are cheap. Measurements run only when you click their button, on a card of the Overview or in the header of their page, one at a time, so the dashboard stays light. Once measured, the button reads **↻ Check again**, **↻ Measure again** or **↻ Analyze again**, and the card shows when it was measured. Measurements are remembered: after a reload (or a restart) they come back with their time. Only the health check runs again by itself, since it takes half a second; RAM/CPU and disk wait for your click.

## 3. Health & resource advisor

![Health & resource advisor](images/en-advisor.png)

The **Health** page answers three questions from what you measured. Its header carries the same three buttons as the Overview cards:

- **Check** on *Docker health* fills *What is wrong?*
- **Measure** on *Container RAM* (`docker stats`) and **Analyze** on *Reclaimable disk* (`docker system df -v`) fill *Where is waste?*. The same results also fill [Free up memory](#8-free-up-memory) and [Disk](#10-clean-disk-space-safely).
- *What to do now?* combines whatever has been measured, and says what is not covered yet.

After you start or stop something, the summary says the figures are older; click ↻ to update them.

**What is wrong?** The health score starts at 100. Each problem deducts a fixed number of points, never an opaque number, and every line shows the cause, the fix and a button (open the log, review and start, details…). Hover a line for Docker's own explanation. 90–100 is *Healthy*, 70–89 *Needs attention*, below 70 *Unhealthy*. *How the score works* lists every rule:

| Problem | Points | Max |
|---|---|---|
| Docker Engine unreachable | −100 | |
| Crash loop | −15 each | −45 |
| Out of memory while running | −12 each | −36 |
| Unhealthy container / failed to start | −10 each | −30 each |
| Container at 90%+ of its own memory limit | −8 each | −24 |
| Port conflict (a stopped container cannot start) / missing network | −6 each | −18 each |
| Service down while the rest of its project runs | −5 each | −15 |
| Out of memory in the last run | −4 each | −12 |
| macOS memory pressure critical / warning | −20 / −8 | |
| Docker VM memory 90%+ used | −10 | |

**Where is waste?**
- *Idle projects*: running, but with no network traffic and CPU under 1% between two RAM/CPU measurements at least 15 minutes apart. Low CPU alone never makes a project idle. After the first measurement, the advisor tells you when to measure again.
- Containers burning CPU in a crash loop.
- Disk Docker could give back (build cache, dangling and unused images, stopped containers, unused volumes), each with its safety level.

**What to do now?** A ranked list, most serious first. Each action carries its level: **Urgent** (broken right now: crash loop, out of memory, failed start), **Important** (degraded service or memory pressure), **Recommended** (idle projects, past problems) and **Optional** (disk housekeeping). Each column keeps the same height and scrolls on its own, so the page does not jump.
- Each action shows the estimated gain (≈ RAM or disk), a risk level and a button. Start and stop buttons open the usual review window; nothing runs without it.
- Idle projects are suggested together. A project they need (database, proxy) is added only when it is idle too and nothing else uses it. Under memory pressure (macOS warning or Docker VM 80%+), the largest projects are suggested as well, marked *Review first* because they are in use.
- Disk: safe categories come with a command to copy; images and volumes open the Disk section. Volumes are never removed automatically.
- **Keep running** lists the running projects that should stay, with the reason: marked keep running, used by another running project, in use, or not measured long enough yet.

To change the idle threshold: `DEV_MANAGER_IDLE_MINUTES=30 npm start`.

## 4. Start, stop, restart

Use the buttons on each card: the next step in words, the others as icons (hover one for its name).

| Button | What it does | Your data |
|---|---|---|
| **▶ Start** | Starts the project's existing containers (`docker compose start`). Never recreates them. | Untouched |
| **■ Stop** | Stops the containers (`docker compose stop`). | Containers and volumes kept |
| **↻ Restart** | Restarts the containers. | Untouched |
| **Terminal** | Opens Terminal in the project's folder (where its Compose file is). | Untouched |

Before every action the dashboard checks for problems. If everything is fine, it runs at once. If not, a review window opens:

![Stop review](images/en-stop-review.png)

- **Red** messages block the action because Docker would fail anyway, for example *"Port 5432 needed by db is taken by running container …"*. The message names the container to stop or the port to change.
- **Amber** messages are warnings you can accept. In the example, other projects use the network of `infra`, so stopping it would break them.
- Related projects appear **unticked**. Tick them if you want to include them; nothing outside your selection runs.
- A project that other running projects still use, or that you marked *keep running*, is also left **unticked**, as in the example. Stopping it has to be a deliberate choice.

### One container at a time

Like Docker Desktop, every container can be controlled on its own. On a card, click the **container bar** (or open **Details**). Each container gets a row with its name, then its state, RAM and CPU (once measured) and its host ports (click one to open it in the browser), and its buttons: **▶ Start** or **■ Stop**, **↻ Restart**, **Logs**, and two Terminal buttons:

- The **terminal** icon opens Terminal with a shell inside the container (`docker exec`, bash when available), already in its working directory, for example `/var/www/api`. Only for a running container. On Windows it opens in a new console window (Windows Terminal on Windows 11).
- The **folder** icon opens Terminal on your computer at the container's source folder (PowerShell on Windows): the folder mounted on its working directory, for example `~/Projects/api`. Greyed out when the code lives inside the image or a volume.


- Each state has its own colour, icon and words on the row, and the same colour in the card's container bar: **● Running** (green), **‖ Paused** (amber), **■ Stopped** (grey), **✕ Failed** with its exit code or *Out of memory* (red), **↻ Restarting** (red, a crash loop), **◐ Starting** and **○ Created** (blue). A stop with the usual codes (0, 137, 143) counts as stopped, not failed.
- They run `docker start`, `docker stop` or `docker restart` on that one container. Its neighbours keep running, and a restart never starts the services it depends on.
- The same checks apply. Stopping a container that others need (`depends_on`), that sits on a network another running project uses, or that belongs to a *keep running* project opens a review first, for example *"app, worker depend on mariadb: they keep running but may fail until mariadb is back."*
- Starting one is blocked when its port is taken or its network no longer exists, and warns when a service it depends on is stopped.

## 5. Why is a project not running?

The card shows the most serious problem under the project's name. Click the name for the full picture:

![Project details](images/en-details.png)

- **Needs attention** explains each problem in plain words:
  - *restarted N times*: a crash loop. The process keeps failing, often because a service it needs (database, cache) is stopped.
  - *exited with code N*: common codes are explained, such as 255 when Docker Desktop stopped, 137 when the container was killed, or 1 for an application error.
  - *OOM-killed*: the container ran out of memory.
  - *unhealthy* and *failed to start*: Docker's own reason is shown.
- **Containers** lists every service with its state, exit code, restart count, health, ports and limits, plus a **Log** link.
- **Needs / Used by** show links to other projects through shared Docker networks.
- **Do it in a terminal** lists the exact commands, ready to copy.
- **Finder / Terminal / VS Code** open the project folder (macOS; on Windows **File Explorer / Terminal / VS Code**).

Containers with restart policy `unless-stopped` or `always` that are stopped were stopped on purpose, so they are not reported as problems.

## 6. Read logs

Click the **Logs** icon on a card, or **Log** next to a problem to open that service directly.

![Logs](images/en-logs.png)

- Choose a **Service** or *All services*, and 150 or 500 **Lines**.
- **Errors only** keeps the lines that contain words such as *error*, *fatal*, *exception*, *refused*, *killed*.
- **Copy CLI command** copies the matching `docker compose … logs -f` command so you can follow the logs live in a terminal.

Log text is always shown exactly as Docker returns it.

## 7. Groups from Docker

Docker already groups containers into Compose projects; each card is one project. Groups go one level up: they put together the **projects that need each other**. You don't create them, because they come from Docker.

When a project's containers join a network created by another project (an `external` network in Compose, typically an app using a shared database or proxy stack), the dashboard forms a group named after the app. The group holds the app and every project it needs. In the screenshot, `blog` and `storefront` both use the network of `infra`, so there are two groups: *blog with infra* and *storefront with infra*. Projects that need nothing else get no group; their own card is enough.

1. Click **▶** on a group to start everything the app needs. A review always opens and lists every container that will be affected; projects already running are skipped:

![Group start review](images/en-group-start.png)

2. Click **■** to stop the group. The shared project is left unticked if another running project still uses it.
3. Projects run one at a time; the projects others depend on start first and stop last. **Cancel remaining** stops before the next project.

Groups update by themselves when your Compose files change their networks.

## 8. Free up memory

Open **Resources** in the sidebar, or click the *Container RAM* card. Click **Measure RAM/CPU** here or **Measure** on the *Container RAM* card (`docker stats`, about 2 seconds). The figures are a snapshot with its time, and a project stopped since then drops out of the list.

![Free up memory](images/en-memory.png)

- Running projects are listed largest first, with memory, CPU and how long they have been running.
- **Notes** tell you what to watch out for, such as a crash loop, *"Running … join its network"* (stopping it breaks others), or *keep running*.
- Tick the projects you don't need right now and click **Stop N projects**. A review opens before anything stops.
- To protect shared infrastructure, open its **Details** and click **★ Keep running**. It can no longer be selected here.

Nothing is ever stopped automatically. Low CPU does not mean a project is unused, so the dashboard never calls it idle. **All running containers** shows the per-container figures.

## 9. Pick free ports

Open **Ports** before giving a new project its ports.

![Ports](images/en-ports.png)

- **Check**: type one or more ports (for example `5432 3000`). You get *free*, or who holds the port and the nearest free alternatives.
- **Common defaults** shows at a glance which usual ports (80, 3000, 3306, 5432, 6379, 8080…) are taken and the next free one.
- **By project** groups ports per owner; **By port number** is a sorted table.
  - Green: a running container holds the port.
  - Amber, *reserved*: a **stopped** container will need this port when it starts again. Using it for a new project makes that start fail.
  - Blue: another program on your computer. On macOS, AirPlay Receiver uses 5000 and 7000.
  - *all interfaces* means other machines on your network can reach the port.

Ports from 49152 up are assigned at random by macOS and are never suggested.

## 10. Clean disk space safely

Open **Cleanup** and click **Analyze disk** (it takes a few seconds); **Analyze** on the *Reclaimable disk* card does the same. Three steps show the path: analyze, review each risk, then copy a command and run it yourself.

![Disk usage](images/en-disk.png)

| Risk | Meaning |
|---|---|
| **Safe to clean** | Build cache and dangling images: only slows the next build. Copy the suggested command and run it in a terminal. |
| **Review first** | Unused tagged images (you would pull or rebuild them) and stopped containers (their logs are lost). |
| **May hold data** | Volumes not used by any container. They may contain databases, so they are only listed, with the project they came from. |

The dashboard never deletes anything itself.

## 11. Import a project, Up and Down

**Start**, **Stop**, **Restart** and **Logs** work for every project without importing it. You only need to import for:

- **Up**: create or recreate containers from the Compose file, for example after `Down` or after changing the file.
- **Down**: remove the project's containers and networks. Named volumes are kept.

To import, open **Details** and click **＋ Import project**. This is offered when Docker knows the project's single Compose file. Otherwise click **＋ Add manually** in the header and enter:

- the project name;
- the folder (absolute path);
- the Compose file name relative to that folder (for example `docker-compose.yml`).

**Choose…** next to the folder opens a Finder window (a folder dialog on Windows): pick the folder and the dashboard fills in its path, the Compose file it finds there and, if empty, the name. The description field takes up to 240 characters on several lines.

Up always shows a review first, and checks the Compose file and ports. Down asks for confirmation.

## 12. Language

Use **Tiếng Việt / English** in the header. The page switches instantly and remembers your choice in the settings file, so it stays after a reload or a restart, and on any address you open the dashboard with (localhost or a local domain). Names of projects, containers, paths, ports and log content are never translated.

## 13. Questions and problems

| Problem | What to do |
|---|---|
| *Unable to connect to Docker Engine* | Start Docker Desktop and wait until it is running, then click **Refresh**. |
| A project is missing | Only projects that still have containers are found. Click **Scan Docker**, or **Add manually**. |
| Start is blocked | Read the red message: it names the container holding the port, or the missing network. |
| `N sources` badge | The project name was started from different folders or Compose file sets. Details lists each source, and Stop/Start act on all of them. |
| Port 4173 already in use | Run `DEV_MANAGER_PORT=4174 npm start` (PowerShell: `$env:DEV_MANAGER_PORT=4174; npm start`). |
| No CPU/RAM figures | They are measured on demand: click **Measure** on the *Container RAM* card. If they stay empty, run `docker stats --no-stream` in a terminal to check Docker. |

## 14. Bitbucket: move Git over SSH to ssh.bitbucket.org

From 12 November 2026, `bitbucket.org` serves HTTPS only: every clone, pull, fetch and push over SSH must go through `ssh.bitbucket.org`. Open **Bitbucket SSH** (under *Maintain*) and click **Check this machine**. The check changes nothing; in a few seconds it shows four steps, as the runbook does:

1. **Host key**: whether `~/.ssh/known_hosts` already trusts `ssh.bitbucket.org`. **Add the host key** downloads Bitbucket's keys over HTTPS and adds them only when all three fingerprints match the ones Bitbucket publishes.
2. **Repositories**: every repository in your home folder that reaches Bitbucket over SSH, grouped by SSH host. An alias (for example `bitbucket-work`) is fixed once in `~/.ssh/config` with **Update ~/.ssh/config**: only its `HostName` line changes, so no repository needs touching. A remote that names `git@bitbucket.org` itself is moved with **Update remotes** (`git remote set-url`). HTTPS remotes are not affected.
3. **Connection test**: a real SSH login to `ssh.bitbucket.org` with each alias's own key, so you know it works before the deadline. *Key refused* usually means a key with a passphrase not added with `ssh-add`; *Could not connect* means DNS or a firewall on port 22.
4. **Scripts and crontab** that still name `git@bitbucket.org`: listed for you to edit by hand.

Every fix opens a preview of the exact change first, and the file is backed up next to the original (`config.bak-…`, `known_hosts.bak-…`, `.git/config.bak-…`). After a fix the check runs again.

On a deploy server, where the dashboard does not run, use **Download the script** and run `bash bitbucket-ssh-check.sh` as every user that runs git. It only reads, and ends with READY or NOT YET.
