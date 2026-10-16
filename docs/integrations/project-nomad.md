# Zimi with Project NOMAD

[Project N.O.M.A.D.](https://github.com/Crosstalk-Solutions/project-nomad) (Crosstalk Solutions) is an offline server that runs a stack of containers for you: an Information Library served by Kiwix, Kolibri, maps, an Ollama-based assistant and more. Zimi reads the same ZIM files, so one library can have both: NOMAD's Information Library stays NOMAD's, and Zimi adds search across all of it, the reader, the apps (Zimipedia, Bookshelf, Dictionary), the Almanac, and an MCP server for AI agents.

Point Zimi at NOMAD's ZIM folder and everything NOMAD has is in Zimi. Anything NOMAD downloads shows up in Zimi in about a minute, with no restart. Zimi reads the files where they are: no copy, no move, nothing written beside them.

## In NOMAD, in a minute

This needs **Zimi 1.15.0 or later**. In NOMAD, open **Supply Depot** and choose **Add a custom app**, then enter:

| Field | Value |
| --- | --- |
| Name | `Zimi` |
| Image | `epheterson/zimi:1.15.0` (pin the version; NOMAD's auto-update stays yours to decide) |
| Port | host `8600` to container `8899` |
| Volume | `/opt/project-nomad/storage/zim` to `/nomad` |
| Volume | `/opt/project-nomad/storage/zimi` to `/config` |
| Volume | `/opt/project-nomad/storage/zimi-library` to `/zims` |
| Environment | `ZIMI_EXTRA_ZIM_DIRS=/nomad` |
| Environment | `ZIMI_MANAGE_PASSWORD=<choose a password>` |
| Environment | `ZIMI_TORRENT=0` |

If you moved NOMAD's storage, use your own path on the left of each volume. The same app through NOMAD's API:

```bash
curl -X POST http://<your-nomad>:8080/api/system/services/custom \
  -H 'content-type: application/json' -d '{
  "friendly_name": "Zimi", "image": "epheterson/zimi:1.15.0", "category": "education",
  "ports": [{"container": 8899, "host": 8600}],
  "volumes": [
    {"host_path": "/opt/project-nomad/storage/zim", "container_path": "/nomad"},
    {"host_path": "/opt/project-nomad/storage/zimi", "container_path": "/config"},
    {"host_path": "/opt/project-nomad/storage/zimi-library", "container_path": "/zims"}],
  "env": ["ZIMI_EXTRA_ZIM_DIRS=/nomad", "ZIMI_MANAGE_PASSWORD=<choose a password>", "ZIMI_TORRENT=0"]
}'
```

Then make the Information Library tile open Zimi: in **Supply Depot**, find **Information Library**, choose **Manage**, then **Edit**, and set its launch URL to `http://<your-nomad>:8600`. Or with the API: `curl -X PUT http://<your-nomad>:8080/api/system/services/custom-url -H 'content-type: application/json' -d '{"service_name": "nomad_kiwix_server", "custom_url": "http://<your-nomad>:8600"}'`. NOMAD keeps its own link and the override survives its upgrades; clear the field to switch back. Kiwix keeps running underneath for NOMAD's own plumbing.

What the three volumes and settings do:

- `/nomad` is NOMAD's ZIM folder, read in place. Zimi never writes, renames or deletes there, even though NOMAD offers no read-only option for a custom app's volumes.
- `/config` holds Zimi's own state (indexes, bookmarks, settings). `/zims` is Zimi's own library, for ZIMs you fetch or create in Zimi. Neither folder has to exist or be owned by anyone: Docker creates a missing bind folder as root, and the image takes ownership of an empty one itself before it drops to its own user. A folder that already holds files, or belongs to another user, is never changed.
- `ZIMI_MANAGE_PASSWORD` is the admin password. Setting it here means a fresh install opens straight to the library and never shows the setup-key screen; searching and reading need no login, only changing settings does. Do not use `ZIMI_LAN_ADMIN=1` for this: it trusts any client that looks local, and behind a proxy, a tunnel or a Docker network every client looks local, so Zimi cannot tell your LAN from the internet.
- `ZIMI_TORRENT=0` keeps Zimi from asking your router to open a port. HTTP downloads still work.

### What you see

Tap the Information Library tile and you land in Zimi with NOMAD's ZIMs, searchable together.

- **Nothing downloaded yet:** Zimi says Project NOMAD has no ZIMs yet and that content downloaded there shows up here in about a minute.
- **One ZIM:** Zimi opens it directly.
- **NOMAD still downloading:** the home page says what is arriving ("Downloading in Project NOMAD: 1 ZIM, 52 MB so far"). A ZIM appears about a minute after NOMAD finishes it (NOMAD writes it as `.zim.tmp` first and renames it when whole).
- **NOMAD removes a ZIM:** it leaves Zimi in under a minute. Bookmarks to it stay and read "Source no longer installed", and come back if the ZIM does.
- **Anything that would write to NOMAD's folder is off:** Delete is replaced by "In Project NOMAD" on each ZIM, and tapping it says why. NOMAD's updates are NOMAD's.
- **Two NOMAD ZIMs of one family** (for example a mini and a full Wikipedia) are one entry in Zimi: the newer edition is shown, and Settings, Server, Storage says how many are not shown.

### Links you already have

Kiwix addresses from NOMAD's Information Library work against Zimi, so bookmarks and pasted links keep working: `/content/<book>/<page>`, `/viewer#<book>/<page>`, and a pasted Kiwix search (`/search?content=<book>&pattern=<words>`). A Kiwix book name carries the file's date (`wikipedia_en_100_2026-08`); Zimi finds the ZIM either way. Nothing else of Kiwix's is imitated: NOMAD does not use Kiwix's catalog or raw endpoints, so Zimi has no use for them either.

## What Zimi will and will not do to NOMAD's files

A folder added this way is read-only as far as Zimi is concerned, whether or not the mount allows writing.

- Zimi never deletes, renames or updates a ZIM in it. The Delete button is replaced by the folder's name, and Zimi's update checks skip those ZIMs, so a newer edition is NOMAD's to fetch (NOMAD's own Information Library does that, including its opt-in automatic updates).
- A ZIM with the same name in Zimi's own folder wins over NOMAD's copy, even a newer one. The Storage card says how many files it is not showing for that reason, and the row of Zimi's own ZIM says "Also in Project NOMAD".
- A ZIM Zimi cannot open (damaged, still arriving, or not readable by Zimi) is listed with the reason and left out of the count.
- A ZIM NOMAD removes or replaces leaves Zimi's library on its own.
- Zimi's downloads go to Zimi's own folder, not NOMAD's. NOMAD does not see them (see [sharing one folder](#sharing-one-folder-both-ways) if you want that).

## Docker

The same setup outside NOMAD's custom-app form. This needs **Zimi 1.15.0 or later**. An older image ignores `ZIMI_EXTRA_ZIM_DIRS` without a word and shows an empty library, so check the version under Settings, Server first.

NOMAD keeps its ZIMs in `<storage>/zim`, and its installer puts storage at `/opt/project-nomad/storage` ([install script](https://github.com/Crosstalk-Solutions/project-nomad/blob/main/install/install_nomad.sh), [compose file](https://github.com/Crosstalk-Solutions/project-nomad/blob/main/install/management_compose.yaml)). If you moved NOMAD's storage, use your path in place of `/opt/project-nomad/storage` below. Mount the folder read-only and tell Zimi about it:

```yaml
services:
  zimi:
    image: epheterson/zimi
    ports:
      - "8899:8899"
    volumes:
      - ./zims:/zims
      - zimi_config:/config
      - /opt/project-nomad/storage/zim:/nomad:ro
    environment:
      - ZIMI_DATA_DIR=/config
      - ZIMI_EXTRA_ZIM_DIRS=/nomad

volumes:
  zimi_config:
```

NOMAD writes its files readable by everyone, and Zimi's container needs read access to them (and search access to the folder). A file or folder NOMAD's installer did not create may be root-only: Zimi lists such a ZIM as "Can't open: Zimi has no permission to read it" instead of hiding it.

Open http://localhost:8899. NOMAD's ZIMs are there, each marked "Project NOMAD". `ZIMI_EXTRA_ZIM_DIRS` takes several folders separated by `:` (`;` on Windows). A folder laid out the way NOMAD lays out its storage (`.../storage/zim` with `kiwix-library.xml` beside the ZIMs, or NOMAD's `maps` or `kolibri` folders next to `zim`) is named "Project NOMAD" wherever you put it; any other folder is named after itself, and you can rename a folder you added from Settings.

Zimi runs happily next to NOMAD on the same machine. NOMAD uses port 8080 for its Command Center; Zimi uses 8899.

## Without Docker, or from Settings

Run Zimi on the NOMAD machine (a Debian-based host is what NOMAD installs on, and Zimi runs there from pip or the snap) and open Settings, Server. If Zimi finds NOMAD's library at `/opt/project-nomad/storage/zim`, Storage offers it once: Add or Not now. You can also type any folder under "Other library folders" there, or set `ZIMI_EXTRA_ZIM_DIRS`. Stop reading a folder from the same place; its files are not touched.

Each folder is read flat: the `.zim` files directly in it, not its subfolders. That is how NOMAD and Kiwix lay a library out.

## An offline research agent over the same library

You do not have to index NOMAD's content into its knowledge base to let an AI use it. Zimi's MCP server searches the ZIMs directly, with filters, and reads pages as Markdown, so a small local model can look things up instead of holding a vector index of them.

Add NOMAD's folder to the MCP server's environment. Give it a folder of its own as well, for its search indexes, so nothing is written into NOMAD's folder:

```json
{
  "mcpServers": {
    "zimi": {
      "command": "zimi-mcp",
      "args": ["/path/to/zims"],
      "env": { "ZIMI_EXTRA_ZIM_DIRS": "/opt/project-nomad/storage/zim" }
    }
  }
}
```

`/path/to/zims` can be an empty folder. For a client on another machine, run `docker exec -i zimi python3 -m zimi mcp` over ssh against the container above. The tools, their sizes and the OpenWebUI setup are in [OpenWebUI / Generic AI Integration](openwebui.md) and [API & MCP](../features/api-and-mcp.md).

## Sharing one folder, both ways

If you want a download made in either program to land in one place, mount NOMAD's ZIM folder read-write as Zimi's own library instead. Zimi then owns that folder, so it can delete and update the ZIMs in it:

```yaml
    volumes:
      - /opt/project-nomad/storage/zim:/zims
      - zimi_config:/config
    environment:
      - ZIMI_DATA_DIR=/config
```

Keep `ZIMI_DATA_DIR` outside the folder (Zimi would otherwise create `.zimi` inside NOMAD's library), and leave Zimi's auto-update off unless you want it to replace editions NOMAD also manages. NOMAD serves what is on disk through Kiwix, and its Information Library has a Rescan Library button for files added outside its own download flow, so ZIMs Zimi downloads appear in NOMAD after a rescan there. NOMAD keeps its own record of what it installed, so a ZIM only Zimi fetched is not part of NOMAD's content updates.

## What is not covered

NOMAD's maps are PMTiles files in `<storage>/maps/pmtiles`. Zimi's Maps app reads StreetZim ZIM maps, so NOMAD's PMTiles maps do not appear in Zimi. NOMAD's Kolibri courses and the assistant's knowledge base are separate from the Information Library, and Zimi does not read them.
