# Obsidian CLI Command Catalog (Observed on 1.12.5)

This is a normalized catalog captured from the CLI command list in Obsidian 1.12.5.
Use it as the fallback truth source when other docs drift.

## Global pattern

```bash
obsidian <command> [flags] [key=value ...]
```

- Boolean switches are passed as bare tokens (`total`, `verbose`, `overwrite`, `open`, etc.).
- Parameters are passed as `key=value`.

## Core commands

- `aliases` — `file=`, `path=`, `total`, `verbose`, `active`
- `append` — `file=`, `path=`, `content=`, `inline`
- `backlinks` — `file=`, `path=`, `counts`, `total`, `format=json|tsv|csv`
- `base:create` — `file=`, `path=`, `view=`, `name=`, `content=`, `open`, `newtab`
- `base:query` — `file=`, `path=`, `view=`, `format=json|csv|tsv|md|paths`
- `base:views`
- `bases`
- `bookmark` — `file=`, `subpath=`, `folder=`, `search=`, `url=`, `title=`
- `bookmarks` — `total`, `verbose`, `format=json|tsv|csv`
- `command` — `id=`
- `commands` — `filter=`
- `create` — `name=`, `path=`, `content=`, `template=`, `overwrite`, `open`, `newtab`
- `deadends` — `total`, `all`
- `delete` — `file=`, `path=`, `permanent`
- `diff` — `file=`, `path=`, `from=`, `to=`, `filter=local|sync`
- `file` — `file=`, `path=`
- `files` — `folder=`, `ext=`, `total`
- `folder` — `path=`, `info=files|folders|size`
- `folders` — `folder=`, `total`
- `help` — `<command>`
- `history` — `file=`, `path=`
- `history:list`
- `history:open` — `file=`, `path=`
- `history:read` — `file=`, `path=`, `version=`
- `history:restore` — `file=`, `path=`, `version=`
- `hotkey` — `id=`, `verbose`
- `hotkeys` — `total`, `verbose`, `format=json|tsv|csv`, `all`
- `links` — `file=`, `path=`, `total`
- `move` — `file=`, `path=`, `to=`
- `open` — `file=`, `path=`, `newtab`
- `orphans` — `total`, `all`
- `outline` — `file=`, `path=`, `format=tree|md|json`, `total`
- `plugin` — `id=`
- `plugin:disable` — `id=`, `filter=core|community`
- `plugin:enable` — `id=`, `filter=core|community`
- `plugin:install` — `id=`, `enable`
- `plugin:reload` — `id=`
- `plugin:uninstall` — `id=`
- `plugins` — `filter=core|community`, `versions`, `format=json|tsv|csv`
- `plugins:enabled` — `filter=core|community`, `versions`, `format=json|tsv|csv`
- `plugins:restrict` — `on`, `off`
- `prepend` — `file=`, `path=`, `content=`, `inline`
- `properties` — `file=`, `path=`, `name=`, `total`, `sort=count`, `counts`, `format=yaml|json|tsv`, `active`
- `property:read` — `name=`, `file=`, `path=`
- `property:remove` — `name=`, `file=`, `path=`
- `property:set` — `name=`, `value=`, `type=text|list|number|checkbox|date|datetime`, `file=`, `path=`
- `random` — `folder=`, `newtab`
- `random:read` — `folder=`
- `read` — `file=`, `path=`
- `recents` — `total`
- `reload`
- `rename` — `file=`, `path=`, `name=`
- `restart`
- `search` — `query=`, `path=`, `limit=`, `total`, `case`, `format=text|json`
- `search:context` — `query=`, `path=`, `limit=`, `case`, `format=text|json`
- `search:open` — `query=`
- `snippet:disable` — `name=`
- `snippet:enable` — `name=`
- `snippets`
- `snippets:enabled`
- `sync` — `on`, `off`
- `sync:deleted` — `total`
- `sync:history` — `file=`, `path=`, `total`
- `sync:open` — `file=`, `path=`
- `sync:read` — `file=`, `path=`, `version=`
- `sync:restore` — `file=`, `path=`, `version=`
- `sync:status`
- `tab:open` — `group=`, `file=`, `view=`
- `tabs` — `ids`
- `tag` — `name=`, `total`, `verbose`
- `tags` — `file=`, `path=`, `total`, `counts`, `sort=count`, `format=json|tsv|csv`, `active`
- `task` — `ref=`, `file=`, `path=`, `line=`, `toggle`, `done`, `todo`, `daily`, `status="<char>"`
- `tasks` — `file=`, `path=`, `total`, `done`, `todo`, `status="<char>"`, `verbose`, `format=json|tsv|csv`, `active`, `daily`
- `template:insert` — `name=`
- `template:read` — `name=`, `resolve`, `title=`
- `templates` — `total`
- `theme` — `name=`
- `theme:install` — `name=`, `enable`
- `theme:set` — `name=`
- `theme:uninstall` — `name=`
- `themes` — `versions`
- `unresolved` — `total`, `counts`, `verbose`, `format=json|tsv|csv`
- `vault` — `info=name|path|files|folders|size`
- `vaults` — `total`, `verbose`
- `version`
- `wordcount` — `file=`, `path=`, `words`, `characters`
- `workspace` — `ids`

## Developer commands

- `dev:cdp` — `method=`, `params=`
- `dev:console` — `clear`, `limit=`, `level=log|warn|error|info|debug`
- `dev:css` — `selector=`, `prop=`
- `dev:debug` — `on`, `off`
- `dev:dom` — `selector=`, `total`, `text`, `inner`, `all`, `attr=`, `css=`
- `dev:errors` — `clear`
- `dev:mobile` — `on`, `off`
- `dev:screenshot` — `path=`
- `devtools`
- `eval` — `code=`
