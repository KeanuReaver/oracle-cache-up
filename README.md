# oracle-cache-up README

OracleCacheUp caches Oracle database metadata locally to provide rich hover definitions for tables, views, fields, aliases, CTEs, and inline views directly in SQL files.

## Why OracleCacheUp

Many Oracle developers relied on metadata hovers in previous Oracle VS Code tooling to quickly inspect table structures and field definitions while writing SQL.

OracleCacheUp restores that workflow by building a local metadata cache and providing rich hover information directly within SQL files.

Unlike the original implementation, OracleCacheUp also understands:

- Table aliases
- Common Table Expressions (CTEs)
- Nested CTEs
- Inline views
- Derived CASE expressions
- Custom metadata sources
- Table relationships

## Features

- Hover table definitions
- Hover field datatypes
- Resolve table aliases
- Resolve Common Table Expressions (CTEs)
- Resolve inline views
- Resolve derived CASE expressions
- Optional field and table descriptions
- Multiple saved Oracle connections
- Secure password storage using VS Code SecretStorage
- Generic Oracle, PowerSchool, and Custom metadata sources
- Powerschool inferred table relationships

![Hover Definitions](images/hoverEffect_small.gif)

![Easy to find controls](images/customQuery.png)

## Requirements

Works with Oracle databases.

Includes built-in metadata support for:

- Generic Oracle databases
- PowerSchool Oracle databases

Advanced users may also enter custom metadata queries for environments that store metadata in non-standard locations, or manually edit the generated `cache/metadata.json` file to provide metadata without connecting to a database.

## Getting Started

1. Open any SQL file.
2. Right-click and select **OracleCacheUp → Manage Connections**.
3. Create a connection.
4. Save a password.
5. Refresh the metadata cache.
6. Hover Oracle objects to view definitions.

Alternatively, advanced users may populate the metadata cache manually without creating a database connection.

## Extension Settings

This extension contributes the following settings:

* `oracleCacheUp.connections`: Array of saved connections
* `oracleCacheUp.activeConnection`: Currently active/default connection
* `oracleCacheUp.showDescriptions`: Show/Hide table and field descriptions in the hover data (if available)
* `oracleCacheUp.inferPowerSchoolRelationships`: Show/Hide inferred table relationships
* `oracleCacheUp.hoverDelayMs`: Adds a delay for the hover to make it feel less responsive

## Known Issues

Very large metadata caches (100MB+) may increase memory usage and impact hover performance.

## Release Notes

### 1.0.0

Initial Release.

### 1.0.1

Lowered the minimum supported VS Code version from `1.120.0` to `1.85.0`.

### 1.1.0

- Improved query logic
- Fixed passwords not deleting
- Added viewable inferred table relationships for PowerSchool
- Added simulated customizable delay for hover

### 1.1.1

Added setting to show/hide table extensions rather than have them always shown if they existed.