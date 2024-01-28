const fs = require('fs');
const sql = require('mssql')
const commandLineArgs = require('command-line-args')

const optionDefinitions = [
	{ name: 'user', alias: 'u', type: String, description: "User with rights to the database" },
	{ name: 'password', alias: 'p', type: String, description: "User password" },
	{ name: 'server', alias: 's', type: String, description: "Server name or IP address" },
	{ name: 'database', alias: 'd', type: String, description: "Database name" },
	{ name: 'config', alias: 'c', type: String, description: "Configuration JSON file" },
]

let pool
let dbDoc
let config = {}
let options

async function loadConfig(filename) {
	if (fs.existsSync(filename)) {
		const fileConfigRaw = fs.readFileSync(filename, 'utf8')
		const fileConfigJSON = JSON.parse(fileConfigRaw)
		if (fileConfigJSON.user && fileConfigJSON.password && fileConfigJSON.server && fileConfigJSON.database) {
			return {
				user: fileConfigJSON.user,
				password: fileConfigJSON.password,
				server: fileConfigJSON.server,
				database: fileConfigJSON.database,
				options: {
					encrypt: true,
					trustServerCertificate: true
				}
			}
		} else {
			return { error: `Invalid configuration file ${filename}` }
		}
	} else {
		return { error: `Missing configuration file ${filename}` }
	}
}
async function initDoc() {
	console.log('=== OPENING DOCUMENT ===')
	dbDoc = fs.createWriteStream(`${config.database}.html`)
	dbDoc.write(`
<!DOCTYPE html>
<html lang="en" dir="ltr">

<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>${config.database} - SQL Server Database Documentation</title>
	`)
	const top = fs.readFileSync('top.html', 'utf8')
	dbDoc.write(top)
	dbDoc.write(`\t<h1>${config.database}</h1>\n`)
	const sqlQuery = `
	SELECT sys.databases.*, sys.extended_properties.value AS description
	FROM sys.databases
	  LEFT JOIN sys.extended_properties ON sys.extended_properties.class = 0 AND sys.extended_properties.name = 'MS_Description'
	WHERE sys.databases.name = '${config.database}';
	`
	const dbData = await pool.request()
		.query(sqlQuery)
	// console.log(dbData)
	dbDoc.write('\t<div class="description-box">\n')
	if (dbData.recordset[0].description) {
		dbDoc.write(`
		<div class="object-description">
			<div>//</div>
			<div>${dbData.recordset[0].description}</div>
		</div>
		`)
	}
	dbDoc.write(`
		<p>Created: <strong>${dbData.recordset[0].create_date}</strong></p>
	</div>
	`)
}

async function closeDoc() {
	console.log('=== CLOSING DOCUMENT ===')
	dbDoc.write('</body>\n\n</html>\n')
	await new Promise((resolve, reject) => {
		dbDoc.on('finish', () => {
			resolve()
		}).on('error', err => {
			reject(err);
		})
	})
}

async function writeTableJump(tableData) {
	dbDoc.write('\t<div class="table-jump">\n')
	for (const table of tableData) {
		dbDoc.write(`\t\t<a href="#${table.schemaName === 'dbo' ? '' : table.schemaName + '-'}${table.name}">${table.schemaName === 'dbo' ? '' : table.schemaName + '.'}${table.name}</a>\n`)
	}
	dbDoc.write('\t</div>\n\n')
}

async function processTableData(schemaName, tableName) {
	try {
		const sqlQuery = `
		SELECT TOP 10 *
		FROM ${schemaName === 'dbo' ? '' : schemaName + '.'}${tableName};
		`
		const dbData = await pool.request()
			.query(sqlQuery)
		// console.log(dbData.recordset[0])
		if (dbData.recordset.length === 0) {
			dbDoc.write('\t<h3>No Sample Data</h3>\n')
		} else {
			dbDoc.write('\t<h3>Sample Data</h3>\n')
			dbDoc.write(`\t<div class="table-data" style="--columns: ${Object.keys(dbData.recordset[0]).length};">\n`)
			for (const head in dbData.recordset[0]) {
				dbDoc.write(`\t\t<div class="table-header">${head}</div>\n`)
			}
			for (const row of dbData.recordset) {
				// console.log(row)
				for (const rowVal in row) {
					dbDoc.write(`\t\t<div>${row[rowVal]}</div>\n`)
				}
			}
			dbDoc.write('\t</div>\n')
		}
	} catch (err) {
		console.log('*** TABLE DATA ERROR ***')
		console.log(err)
	}
}

async function processTableCheckConstraints(tableObject) {
	try {
		const sqlQuery = `
		SELECT sys.check_constraints.*, sys.schemas.name AS schemaName, sys.tables.name AS tableName, sys.columns.name AS columnName, sys.extended_properties.value AS description
		FROM sys.check_constraints
		  INNER JOIN sys.tables ON sys.check_constraints.parent_object_id = sys.tables.object_id
		  INNER JOIN sys.schemas ON sys.tables.schema_id = sys.schemas.schema_id
		  LEFT JOIN sys.columns ON sys.check_constraints.parent_object_id = sys.columns.object_id AND sys.check_constraints.parent_column_id = sys.columns.column_id
		  LEFT JOIN sys.extended_properties ON sys.extended_properties.major_id = sys.check_constraints.object_id AND sys.extended_properties.name = 'MS_Description'
		WHERE sys.check_constraints.parent_object_id = ${tableObject}
		ORDER BY name;
		`
		const dbCheckConstraints = await pool.request()
			.query(sqlQuery)
		// console.dir(dbTables)
		// console.log(dbTables.recordset.length)
		if (dbCheckConstraints.recordset.length === 0) {
			return
		}
		dbDoc.write('\t<h3>Check Constraints</h3>\n')
		dbDoc.write('\t<ul class="check-constraints-definition">\n')
		for (const row of dbCheckConstraints.recordset) {
			// console.log(`----Index ${row.name}, is_unique=${row.is_unique} (${typeof(row.is_unique)})`)
			dbDoc.write('\t\t<li>\n')
			if (row.description) {
				dbDoc.write(`
			<div class="inner-description object-description" style="--inner-columns: 3;">
				<div>//</div>
				<div>${row.description}</div>
			</div>
				`)
			}
			dbDoc.write(`\t\t\t<div>${row.name}</div>\n`)
			dbDoc.write(`\t\t\t<div>${row.parent_column_id === 0 ? 'TABLE' : row.columnName}</div>\n`)
			dbDoc.write(`\t\t\t<div style="grid-column: 1 / span 2;">${row.definition}</div>\n`)
			dbDoc.write('\t\t</li>\n')
		}
		dbDoc.write('\t</ul>\n')
	} catch (err) {
		console.log('*** CHECK CONSTRAINTS ERROR ***')
		console.log(err)
	}
}

async function processTableForeignKeys(tableObject) {
	try {
		const sqlQuery = `
		SELECT sys.foreign_keys.*, sys.extended_properties.value AS description
		FROM sys.foreign_keys
		  LEFT JOIN sys.extended_properties ON sys.foreign_keys.object_id = sys.extended_properties.major_id AND sys.extended_properties.minor_id = 0 AND sys.extended_properties.name = 'MS_Description'
		WHERE sys.foreign_keys.parent_object_id = ${tableObject}
		ORDER BY sys.foreign_keys.name;
		`
		const dbForeignKeys = await pool.request()
			.query(sqlQuery)
		// console.dir(dbTables)
		// console.log(dbTables.recordset.length)
		if (dbForeignKeys.recordset.length === 0) {
			return
		}
		dbDoc.write('\t<h3>Foreign Keys</h3>\n')
		dbDoc.write('\t<ul class="foreign-keys-definition">\n')
		for (const row of dbForeignKeys.recordset) {
			// console.log(`----Index ${row.name}, is_unique=${row.is_unique} (${typeof(row.is_unique)})`)
			dbDoc.write('\t\t<li>\n')
			if (row.description) {
				dbDoc.write(`
			<div class="inner-description object-description" style="--inner-columns: 3;">
				<div>//</div>
				<div>${row.description}</div>
			</div>
				`)
			}
			dbDoc.write(`\t\t\t<div>${row.name}</div>\n`)
			const sqlQuery2 = `
			SELECT sys.foreign_key_columns.*,
			  (SELECT name FROM sys.tables WHERE object_id = sys.foreign_key_columns.parent_object_id) AS child_table,
			  (SELECT name FROM sys.columns WHERE object_id = sys.foreign_key_columns.parent_object_id AND column_id = sys.foreign_key_columns.parent_column_id) AS child_column,
			  (SELECT name FROM sys.tables WHERE object_id = sys.foreign_key_columns.referenced_object_id) AS parent_table,
			  (SELECT name FROM sys.columns WHERE object_id = sys.foreign_key_columns.referenced_object_id AND column_id = sys.foreign_key_columns.referenced_column_id) AS parent_column
			FROM sys.foreign_key_columns
			WHERE sys.foreign_key_columns.constraint_object_id = ${row.object_id};
			`
			const dbForeignKeyColumns = await pool.request()
				.query(sqlQuery2)
			dbDoc.write(`\t\t\t<div>${dbForeignKeyColumns.recordset[0].parent_table}</div>\n`)
			let colList = '\t\t\t<div>'
			for (const col of dbForeignKeyColumns.recordset) {
				colList += `${col.child_column} ⥱ ${col.parent_column}`
				if (col.constraint_column_id < dbForeignKeyColumns.recordset.length) {
					colList += ', '
				}
			}
			colList += '</div>\n'
			dbDoc.write(colList)
			dbDoc.write('\t\t</li>\n')
		}
		dbDoc.write('\t</ul>\n')
	} catch (err) {
		console.log('*** FOREIGN KEYS ERROR ***')
		console.log(err)
	}
}

async function processTableIndexes(tableObject) {
	try {
		const sqlQuery = `
		SELECT sys.indexes.*, sys.extended_properties.value AS description
		FROM sys.indexes
		  LEFT JOIN sys.extended_properties ON sys.indexes.object_id = sys.extended_properties.major_id AND sys.indexes.index_id = sys.extended_properties.minor_id AND sys.extended_properties.name = 'MS_Description'
		WHERE object_id = ${tableObject} AND type > 0
		ORDER BY sys.indexes.name;
		`
		const dbIndexes = await pool.request()
			.query(sqlQuery)
		// console.dir(dbTables)
		// console.log(dbTables.recordset.length)
		if (dbIndexes.recordset.length === 0) {
			return
		}
		dbDoc.write('\t<h3>Indexes</h3>\n')
		dbDoc.write('\t<ul class="indexes-definition">\n')
		for (const row of dbIndexes.recordset) {
			// console.log(`----Index ${row.name}, is_unique=${row.is_unique} (${typeof(row.is_unique)})`)
			dbDoc.write('\t\t<li>\n')
			if (row.description) {
				dbDoc.write(`
			<div class="inner-description object-description" style="--inner-columns: 3;">
				<div>//</div>
				<div>${row.description}</div>
			</div>
				`)
			}
			dbDoc.write(`\t\t\t<div>${row.name}</div>\n`)
			dbDoc.write(`\t\t\t<div class="align-center">${row.is_unique ? 'UNIQUE' : ''}</div>\n`)
			const sqlQuery2 = `
			SELECT sys.index_columns.*, sys.columns.name
			FROM sys.index_columns
			  INNER JOIN sys.columns ON sys.columns.object_id = sys.index_columns.object_id AND sys.index_columns.column_id = sys.columns.column_id
			WHERE sys.index_columns.object_id = ${tableObject} AND sys.index_columns.index_id = ${row.index_id};
			`
			const dbIndexColumns = await pool.request()
				.query(sqlQuery2)
			let colList = '\t\t\t<div>'
			for (const col of dbIndexColumns.recordset) {
				colList += col.name
				colList += col.is_descending_key === 0 ? ' <svg><use href="#sort-desc"></use></svg>' : ' <svg><use href="#sort-asc"></use></svg>'
				if (col.index_column_id < dbIndexColumns.recordset.length) {
					colList += ', '
				}
			}
			colList += '</div>\n'
			dbDoc.write(colList)
			dbDoc.write('\t\t</li>\n')
		}
		dbDoc.write('\t</ul>\n')
	} catch (err) {
		console.log('*** TABLE INDEXES ERROR ***')
		console.log(err)
	}
}

async function processTableColumns(tableObject) {
	try {
		const sqlQuery = `
		SELECT sys.columns.*, sys.types.name AS typeName, sys.extended_properties.value AS description, sys.identity_columns.seed_value, sys.identity_columns.increment_value
		FROM sys.columns
		  INNER JOIN sys.types ON ((sys.columns.system_type_id = sys.types.system_type_id) and (sys.columns.user_type_id = sys.types.user_type_id))
		  LEFT JOIN sys.extended_properties ON sys.columns.object_id = sys.extended_properties.major_id AND sys.columns.column_id = sys.extended_properties.minor_id AND sys.extended_properties.name = 'MS_Description'
		  LEFT JOIN sys.identity_columns ON sys.columns.object_id = sys.identity_columns.object_id AND sys.columns.column_id = sys.identity_columns.column_id
		WHERE sys.columns.object_id = ${tableObject};
		`
		const dbColumns = await pool.request()
			.query(sqlQuery)
		// console.dir(dbTables)
		// console.log(dbTables.recordset.length)
		dbDoc.write('\t<h3>Columns</h3>\n')
		dbDoc.write('\t<ul class="columns-definition">\n')
		for (const row of dbColumns.recordset) {
			// console.log(`--${row.name}`)
			dbDoc.write('\t\t<li>\n')
			if (row.description) {
				dbDoc.write(`
			<div class="inner-description object-description" style="--inner-columns: 2;">
				<div>//</div>
				<div>${row.description}</div>
			</div>
				`)
			}
			dbDoc.write(`\t\t\t<div>${row.name}</div>\n`)
			let colDef
			switch (row.typeName) {
				case 'binary':
				case 'char':
				case 'datetime2':
				case 'datetimeoffset':
				case 'nchar':
				case 'nvarchar':
				case 'time':
				case 'varbinary':
				case 'varchar':
					colDef = `[${row.typeName}](${row.max_length === -1 ? 'MAX' : row.max_length})`
					break
				case 'decimal':
				case 'numeric':
					colDef = `[${row.typeName}](${row.precision}, ${row.scale})`
					break
				default:
					colDef = `[${row.typeName}]`
			}
			if (row.is_identity) {
				colDef += ` <span class="highlight-blue">IDENTITY</span> (${row.seed_value},${row.increment_value})`
			}
			colDef += row.is_nullable ? ' NULL' : ' NOT NULL'
			dbDoc.write(`\t\t\t<div>${colDef}</div>\n`)
			dbDoc.write('\t\t</li>\n')
		}
		dbDoc.write('\t</ul>\n')
	} catch (err) {
		console.log('*** TABLE COLUMNS ERROR ***')
		console.log(err)
	}
}

async function processTable(table) {
	console.log(`Processing Table: ${table.schemaName === 'dbo' ? '' : table.schemaName + '.'}${table.name}`)
	dbDoc.write(`\t<a id="${table.schemaName === 'dbo' ? '' : table.schemaName + '-'}${table.name}"></a>\n`)
	dbDoc.write(`\t<h2>${table.schemaName === 'dbo' ? '' : table.schemaName + '.'}${table.name}</h2>\n`)
	dbDoc.write('\t<div class="description-box">\n')
	if (table.description) {
		dbDoc.write(`
		<div class="object-description">
			<div>//</div>
			<div>${table.description}</div>
		</div>
		`)
	}
	dbDoc.write(`
		<p>Created: <strong>${table.create_date}</strong>, Modified: <strong>${table.modify_date}</strong></p>
	</div>
	`)
	console.log('--Columns')
	await processTableColumns(table.object_id)
	console.log('--Indexes')
	await processTableIndexes(table.object_id)
	console.log('--Foreign Keys')
	await processTableForeignKeys(table.object_id)
	console.log('--Check Constraints')
	await processTableCheckConstraints(table.object_id)
	console.log('--Sample Data')
	await processTableData(table.schemaName, table.name)
	dbDoc.write('\n')
}

async function processDB () {
	try {
		pool = await sql.connect(config)
		await initDoc()
		const sqlQuery = `
		SELECT sys.tables.*, sys.schemas.name AS schemaName, sys.extended_properties.value AS description
		FROM sys.tables
		  INNER JOIN sys.schemas ON sys.tables.schema_id = sys.schemas.schema_id
		  LEFT JOIN sys.extended_properties ON sys.tables.object_id = sys.extended_properties.major_id AND sys.extended_properties.minor_id = 0 AND sys.extended_properties.name = 'MS_Description'
		ORDER BY sys.schemas.name, sys.tables.name;
		`
		const dbTables = await pool.request()
			.query(sqlQuery)
		// console.dir(dbTables)
		// console.log(dbTables.recordset.length)
		await writeTableJump(dbTables.recordset)
		for (const row of dbTables.recordset) {
			// console.log(row.name)
			await processTable(row)
		}
		await closeDoc()
		process.exit()
	} catch (err) {
		console.log('*** STARTUP ERROR ***')
		console.log(err)
	}
}

async function startup() {
	if (options.config) {
		config = await loadConfig(options.config)
		if (config.error) {
			console.log(config.error)
			process.exit()
		}
	} else if (options.user && options.password && options.server && options.database) {
		config = {
			user: options.user,
			password: options.password,
			server: options.server,
			database: options.database,
			options: {
				encrypt: true,
				trustServerCertificate: true
			}
		}
	} else if (!options.user && !options.password && !options.server && !options.database) {
		config = await loadConfig('config.json')
		if (config.error) {
			console.log(config.error)
			process.exit()
		}
	} else {
		console.log('To access a database through command line arguments all must be preset.')
		if (!options.user) {
			console.log('--user (-u) User not specified')
		}
		if (!options.password) {
			console.log('--password (-p) Password not specified')
		}
		if (!options.server) {
			console.log('--server (-s) Server not specified')
		}
		if (!options.database) {
			console.log('--database (-d) Database not specified')
		}
	}
	console.log(config)
	processDB()
}

console.log('SQL Server Database Documentation Generator v0.5\n')

try {
	options = commandLineArgs(optionDefinitions)
} catch (err) {
	if (err.name === 'UNKNOWN_OPTION') {
		console.log(`Unknown option: ${err.optionName}`)
	} else {
		console.log('*** COMMAND LINE ARGUMENTS ERROR ***')
		console.dir(err)
	}
	process.exit()
}

startup()
