# SQL Server Database Documentation Generator

Create HTML documentation for a SQL Server database.

## Description

Creates an HTML document that describes a SQL Server database. Output for each table includes columns, indexes, foreign keys, check constraints and up to ten rows of sample data. A quick jump tag list of all tables is placed at the top.

You can view sample output based on Microsoft's `AdventureWorks2014` database here:

[GitHub Pages](https://clubside.github.io/mssql-db-document/)

This is very work-in-progress for a specific need but I'm hoping to make it more robust for general usage. Feel free to make comments or suggestion in the Discussions area.

## Usage

The tool can be operated through command line arguments or a `JSON` configuration file. If neither a configuration file nor the four database-related arguments is provided the tool will attempt to load `config.json`.

The configuration file follows this format:

```json
{
    "user": "username",
    "password": "userpassword",
    "server": "servername",
    "database": "databasename"
}
```

The `config.json` included in this package matches the above code and will not function without editing with real values. The file exists simply as a template.

The command line arguments are:

| Argument | Description |
| --- | --- |
| **--config**, **-c** *file name* | File with JSON configuration data |
| **--user**, **-u** *user name* | User with privileges to access the database |
| **--password**, **-p** *user password* | Password for database user |
| **--server**, **-s** *server name or IP* | Server computer name or IP address |
| **--database**, **-d** *database name* | Name of the database on the server to document |

Including `--config` or `-c` will override the other arguments if a file name is passed.
