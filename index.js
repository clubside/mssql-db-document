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

const dbObjects = {}

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
	dbDoc.write(`
	<script src="https://cdnjs.cloudflare.com/ajax/libs/prism/9000.0.1/prism.min.js"></script>
	<script src="https://cdnjs.cloudflare.com/ajax/libs/prism/9000.0.1/components/prism-sql.min.js"></script>
</body>

</html>\n`)
	await new Promise((resolve, reject) => {
		dbDoc.on('finish', () => {
			resolve()
		}).on('error', err => {
			reject(err);
		})
	})
}

function stringDataType(data) {
	let colDef
	switch (data.typeName) {
		case 'binary':
		case 'char':
		case 'datetime2':
		case 'datetimeoffset':
		case 'time':
		case 'varbinary':
		case 'varchar':
			colDef = `[${data.typeName}](${data.max_length === -1 ? 'MAX' : data.max_length})`
			break
		case 'nchar':
		case 'nvarchar':
			colDef = `[${data.typeName}](${data.max_length === -1 ? 'MAX' : (data.max_length / 2)})`
			break
		case 'decimal':
		case 'numeric':
			colDef = `[${data.typeName}](${data.precision}, ${data.scale})`
			break
		default:
			colDef = `[${data.typeName}]`
	}
	if (data.is_identity) {
		colDef += ` <span class="highlight-blue">IDENTITY</span> (${data.seed_value},${data.increment_value})`
	}
	colDef += data.is_nullable ? ' NULL' : ' NOT NULL'
	if (data.definition) {
		colDef += ` <span class="highlight-blue">DEFAULT</span> ${data.definition}`
	}
	return colDef
 }

 async function writeFunctionsScalarJump(functionsScalarData) {
	dbDoc.write('\n\n\t<a id="functions-scalar"></a>\n')
	dbDoc.write('\t<h2>Functions: Scalar</h2>\n')
	dbDoc.write('\t<div class="jump">\n')
	for (const functionScalar of functionsScalarData) {
		dbDoc.write(`\t\t<a href="#function-scalar-${functionScalar.schemaName === 'dbo' ? '' : functionScalar.schemaName + '-'}${functionScalar.name}">${functionScalar.schemaName === 'dbo' ? '' : functionScalar.schemaName + '.'}${functionScalar.name}</a>\n`)
	}
	dbDoc.write('\t</div>\n\n')
}

async function writeStoredProcedureJump(storedProceduresData) {
	dbDoc.write('\n\n\t<a id="stored-procedures"></a>\n')
	dbDoc.write('\t<h2>Stored Procedures</h2>\n')
	dbDoc.write('\t<div class="jump">\n')
	for (const storedProcedure of storedProceduresData) {
		dbDoc.write(`\t\t<a href="#stored-procedure-${storedProcedure.schemaName === 'dbo' ? '' : storedProcedure.schemaName + '-'}${storedProcedure.name}">${storedProcedure.schemaName === 'dbo' ? '' : storedProcedure.schemaName + '.'}${storedProcedure.name}</a>\n`)
	}
	dbDoc.write('\t</div>\n\n')
}

async function writeViewJump(viewData) {
	dbDoc.write('\n\n\t<a id="views"></a>\n')
	dbDoc.write('\t<h2>Views</h2>\n')
	dbDoc.write('\t<div class="jump">\n')
	for (const view of viewData) {
		dbDoc.write(`\t\t<a href="#view-${view.schemaName === 'dbo' ? '' : view.schemaName + '-'}${view.name}">${view.schemaName === 'dbo' ? '' : view.schemaName + '.'}${view.name}</a>\n`)
	}
	dbDoc.write('\t</div>\n\n')
}

async function writeTableJump(tableData) {
	dbDoc.write('\n\n\t<a id="tables"></a>')
	dbDoc.write('\t<h2>Tables</h2>\n')
	dbDoc.write('\t<div class="jump">\n')
	for (const table of tableData) {
		dbDoc.write(`\t\t<a href="#table-${table.schemaName === 'dbo' ? '' : table.schemaName + '-'}${table.name}">${table.schemaName === 'dbo' ? '' : table.schemaName + '.'}${table.name}</a>\n`)
	}
	dbDoc.write('\t</div>\n\n')
}

async function writeObjectJump() {
	dbDoc.write('\n\n\t<h2>Objects</h2>\n')
	dbDoc.write('\t<div class="jump">\n')
	if (dbObjects.USER_TABLE) {
		dbDoc.write(`\t\t<a href="#tables">Tables (${dbObjects.USER_TABLE})</a>\n`)
	}
	if (dbObjects.VIEW) {
		dbDoc.write(`\t\t<a href="#views">Views (${dbObjects.VIEW})</a>\n`)
	}
	if (dbObjects.SQL_STORED_PROCEDURE) {
		dbDoc.write(`\t\t<a href="#stored-procedures">Stored Procedures (${dbObjects.SQL_STORED_PROCEDURE})</a>\n`)
	}
	if (dbObjects.SQL_SCALAR_FUNCTION) {
		dbDoc.write(`\t\t<a href="#functions-scalar">Functions: Scalar (${dbObjects.SQL_SCALAR_FUNCTION})</a>\n`)
	}
	dbDoc.write('\t</div>\n\n')
}

async function processFunctionsScalarParameters(functionsScalarObject) {
	try {
		const sqlQuery = `
		SELECT sys.parameters.*, sys.types.name AS typeName, sys.extended_properties.value AS description
		FROM sys.parameters
		  INNER JOIN sys.types ON ((sys.parameters.system_type_id = sys.types.system_type_id) and (sys.parameters.user_type_id = sys.types.user_type_id))
		  LEFT JOIN sys.extended_properties ON sys.extended_properties.major_id = sys.parameters.object_id AND sys.extended_properties.minor_id = sys.parameters.parameter_id AND sys.extended_properties.name = 'MS_Description'
		WHERE sys.parameters.object_id = ${functionsScalarObject};
		`
		const dbParameters = await pool.request()
			.query(sqlQuery)
		// console.dir(dbTables)
		// console.log(dbTables.recordset.length)
		if (dbParameters.recordset.length > 0) {
			dbDoc.write('\t<h4>Parameters</h4>\n')
			dbDoc.write('\t<ul class="definition definition-columns">\n')
			for (const row of dbParameters.recordset) {
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
				dbDoc.write(`\t\t\t<div>${row.name === '' ? '<span class="highlight-blue"><em>returns</em></span>' : row.name}</div>\n`)
				dbDoc.write(`\t\t\t<div>${stringDataType(row)}</div>\n`)
				dbDoc.write('\t\t</li>\n')
			}
			dbDoc.write('\t</ul>\n')
		}
	} catch (err) {
		console.log('*** FUNCTIONS: SCALAR PARAMETERS ERROR ***')
		console.log(err)
	}
}

async function processFunctionsScalar() {
	try {
		const sqlQuery = `
		SELECT sys.objects.*, sys.schemas.name AS schemaName, sys.sql_modules.definition, sys.extended_properties.value AS description
		FROM sys.objects
		  INNER JOIN sys.schemas ON sys.schemas.schema_id = sys.objects.schema_id
		  INNER JOIN sys.sql_modules ON sys.objects.object_id = sys.sql_modules.object_id
		  LEFT JOIN sys.extended_properties ON sys.extended_properties.major_id = sys.objects.object_id AND sys.extended_properties.minor_id = 0 AND sys.extended_properties.name = 'MS_Description'
		WHERE sys.objects.type = 'FN'
		ORDER BY sys.objects.name;
		`
		const dbFunctions = await pool.request()
			.query(sqlQuery)
		// console.dir(dbTables)
		// console.log(dbTables.recordset.length)
		await writeFunctionsScalarJump(dbFunctions.recordset)
		for (const functionScalar of dbFunctions.recordset) {
			console.log(`Processing Function (Scalar): ${functionScalar.schemaName === 'dbo' ? '' : functionScalar.schemaName + '.'}${functionScalar.name}`)
			dbDoc.write(`\t<a id="functions-scalar-${functionScalar.schemaName === 'dbo' ? '' : functionScalar.schemaName + '-'}${functionScalar.name}"></a>\n`)
			dbDoc.write(`\t<h3>${functionScalar.schemaName === 'dbo' ? '' : functionScalar.schemaName + '.'}${functionScalar.name}</h3>\n`)
			dbDoc.write('\t<div class="description-box">\n')
			if (functionScalar.description) {
				dbDoc.write(`
		<div class="object-description">
			<div>//</div>
			<div>${functionScalar.description}</div>
		</div>\n`)
			}
			dbDoc.write(`
		<p>Created: <strong>${functionScalar.create_date}</strong>, Modified: <strong>${functionScalar.modify_date}</strong></p>
	</div>
			`)
			await processFunctionsScalarParameters(functionScalar.object_id)
			dbDoc.write('\t<h4>Definition</h4>\n')
			dbDoc.write('\t<pre>\n<code class="language-sql">')
			dbDoc.write(functionScalar.definition)
			dbDoc.write('</code>\n\t</pre>\n')
		}
	} catch (err) {
		console.log('*** FUNCTIONS: SCALAR ERROR ***')
		console.log(err)
	}
}

async function processStoredProceduresParameters(storedProcedureObject) {
	try {
		const sqlQuery = `
		SELECT sys.parameters.*, sys.types.name AS typeName, sys.extended_properties.value AS description
		FROM sys.parameters
		  INNER JOIN sys.types ON ((sys.parameters.system_type_id = sys.types.system_type_id) and (sys.parameters.user_type_id = sys.types.user_type_id))
		  LEFT JOIN sys.extended_properties ON sys.extended_properties.major_id = sys.parameters.object_id AND sys.extended_properties.minor_id = sys.parameters.parameter_id AND sys.extended_properties.name = 'MS_Description'
		WHERE sys.parameters.object_id = ${storedProcedureObject};
		`
		const dbParameters = await pool.request()
			.query(sqlQuery)
		// console.dir(dbTables)
		// console.log(dbTables.recordset.length)
		if (dbParameters.recordset.length > 0) {
			dbDoc.write('\t<h4>Parameters</h4>\n')
			dbDoc.write('\t<ul class="definition definition-columns">\n')
			for (const row of dbParameters.recordset) {
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
				dbDoc.write(`\t\t\t<div>${stringDataType(row)}</div>\n`)
				dbDoc.write('\t\t</li>\n')
			}
			dbDoc.write('\t</ul>\n')
		}
	} catch (err) {
		console.log('*** TABLE COLUMNS ERROR ***')
		console.log(err)
	}
}

async function processStoredProcedures() {
	try {
		const sqlQuery = `
		SELECT sys.procedures.*, sys.schemas.name AS schemaName, sys.sql_modules.definition, sys.extended_properties.value AS description
		FROM sys.procedures
		  INNER JOIN sys.schemas ON sys.schemas.schema_id = sys.procedures.schema_id
		  INNER JOIN sys.sql_modules ON sys.sql_modules.object_id = sys.procedures.object_id
		  LEFT JOIN sys.extended_properties ON sys.extended_properties.major_id = sys.procedures.object_id AND sys.extended_properties.minor_id = 0 AND sys.extended_properties.name = 'MS_Description'
		ORDER BY sys.schemas.name, sys.procedures.name;
		`
		const dbStoredProcedures = await pool.request()
			.query(sqlQuery)
		// console.dir(dbTables)
		// console.log(dbTables.recordset.length)
		await writeStoredProcedureJump(dbStoredProcedures.recordset)
		for (const storedProcedure of dbStoredProcedures.recordset) {
			console.log(`Processing Stored Procedure: ${storedProcedure.schemaName === 'dbo' ? '' : storedProcedure.schemaName + '.'}${storedProcedure.name}`)
			dbDoc.write(`\t<a id="stored-procedure-${storedProcedure.schemaName === 'dbo' ? '' : storedProcedure.schemaName + '-'}${storedProcedure.name}"></a>\n`)
			dbDoc.write(`\t<h3>${storedProcedure.schemaName === 'dbo' ? '' : storedProcedure.schemaName + '.'}${storedProcedure.name}</h3>\n`)
			dbDoc.write('\t<div class="description-box">\n')
			if (storedProcedure.description) {
				dbDoc.write(`
		<div class="object-description">
			<div>//</div>
			<div>${storedProcedure.description}</div>
		</div>\n`)
			}
			dbDoc.write(`
		<p>Created: <strong>${storedProcedure.create_date}</strong>, Modified: <strong>${storedProcedure.modify_date}</strong></p>
	</div>
			`)
			await processStoredProceduresParameters(storedProcedure.object_id)
			dbDoc.write('\t<h4>Definition</h4>\n')
			dbDoc.write('\t<pre>\n<code class="language-sql">')
			dbDoc.write(storedProcedure.definition)
			dbDoc.write('</code>\n\t</pre>\n')
		}
	} catch (err) {
		console.log('*** VIEWS ERROR ***')
		console.log(err)
	}
}

async function processViews() {
	try {
		const sqlQuery = `
		SELECT sys.views.*, sys.schemas.name AS schemaName, sys.sql_modules.definition, sys.extended_properties.value AS description
		FROM sys.views
		  INNER JOIN sys.schemas ON sys.schemas.schema_id = sys.views.schema_id
		  INNER JOIN sys.sql_modules ON sys.sql_modules.object_id = sys.views.object_id
		  LEFT JOIN sys.extended_properties ON sys.extended_properties.major_id = sys.views.object_id AND sys.extended_properties.name = 'MS_Description'
		ORDER BY sys.schemas.name, sys.views.name;
		`
		const dbViews = await pool.request()
			.query(sqlQuery)
		// console.dir(dbTables)
		// console.log(dbTables.recordset.length)
		await writeViewJump(dbViews.recordset)
		for (const view of dbViews.recordset) {
			console.log(`Processing View: ${view.schemaName === 'dbo' ? '' : view.schemaName + '.'}${view.name}`)
			dbDoc.write(`\t<a id="view-${view.schemaName === 'dbo' ? '' : view.schemaName + '-'}${view.name}"></a>\n`)
			dbDoc.write(`\t<h3>${view.schemaName === 'dbo' ? '' : view.schemaName + '.'}${view.name}</h3>\n`)
			dbDoc.write('\t<div class="description-box">\n')
			if (view.description) {
				dbDoc.write(`
		<div class="object-description">
			<div>//</div>
			<div>${view.description}</div>
		</div>\n`)
			}
			dbDoc.write(`
		<p>Created: <strong>${view.create_date}</strong>, Modified: <strong>${view.modify_date}</strong></p>
	</div>
			`)
			dbDoc.write('\t<h4>Definition</h4>\n')
			dbDoc.write('\t<pre>\n<code class="language-sql">')
			dbDoc.write(view.definition)
			dbDoc.write('</code>\n\t</pre>\n')
		}
	} catch (err) {
		console.log('*** VIEWS ERROR ***')
		console.log(err)
	}
}

async function processTableData(schemaName, tableName, tableColumns) {
	try {
		let colCounter = 0
		const sqlQuery = `
		SELECT TOP 10 *
		FROM ${schemaName === 'dbo' ? '' : schemaName + '.'}${tableName};
		`
		const dbData = await pool.request()
			.query(sqlQuery)
		// console.log(dbData.recordset[0])
		if (dbData.recordset.length === 0) {
			dbDoc.write('\t<h4>No Sample Data</h4>\n')
		} else {
			dbDoc.write('\t<h4>Sample Data</h4>\n')
			dbDoc.write(`\t<div class="table-data" style="--columns: ${Object.keys(dbData.recordset[0]).length};">\n`)
			for (const head of tableColumns) {
				dbDoc.write(`\t\t<div class="table-header">${head.name}</div>\n`)
			}
			for (const row of dbData.recordset) {
				// console.log(row)
				colCounter = 0
				for (const rowVal in row) {
					switch (tableColumns[colCounter].dataType) {
						case 'binary':
						case 'geography':
						case 'geometry':
						case 'hierarchyid':
						case 'image':
						case 'varbinary':
						case 'xml':
							dbDoc.write(`\t\t<div>[${tableColumns[colCounter].dataType}]</div>\n`)
							break
						default:
							dbDoc.write(`\t\t<div>${row[rowVal]}</div>\n`)
					}
					colCounter++
				}
			}
			dbDoc.write('\t</div>\n')
		}
	} catch (err) {
		console.log('*** TABLE DATA ERROR ***')
		console.log(err)
		process.exit()
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
		dbDoc.write('\t<h4>Check Constraints</h4>\n')
		dbDoc.write('\t<ul class="definition definition-check-constraints">\n')
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
		dbDoc.write('\t<h4>Foreign Keys</h4>\n')
		dbDoc.write('\t<ul class="definition definition-foreign-keys">\n')
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
		  LEFT JOIN sys.extended_properties ON sys.indexes.object_id = sys.extended_properties.major_id AND sys.indexes.index_id = sys.extended_properties.minor_id AND sys.extended_properties.class = 7 AND sys.extended_properties.name = 'MS_Description'
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
		dbDoc.write('\t<h4>Indexes</h4>\n')
		dbDoc.write('\t<ul class="definition definition-indexes">\n')
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
		SELECT sys.columns.*, sys.types.name AS typeName, sys.extended_properties.value AS description, sys.identity_columns.seed_value, sys.identity_columns.increment_value, sys.default_constraints.definition
		FROM sys.columns
		  INNER JOIN sys.types ON ((sys.columns.system_type_id = sys.types.system_type_id) and (sys.columns.user_type_id = sys.types.user_type_id))
		  LEFT JOIN sys.extended_properties ON sys.columns.object_id = sys.extended_properties.major_id AND sys.columns.column_id = sys.extended_properties.minor_id AND sys.extended_properties.class = 1 AND sys.extended_properties.name = 'MS_Description'
		  LEFT JOIN sys.identity_columns ON sys.columns.object_id = sys.identity_columns.object_id AND sys.columns.column_id = sys.identity_columns.column_id
		  LEFT JOIN sys.default_constraints ON sys.columns.object_id = sys.default_constraints.parent_object_id AND sys.columns.column_id = sys.default_constraints.parent_column_id
		WHERE sys.columns.object_id = ${tableObject};
		`
		const dataColumns = []
		const dbColumns = await pool.request()
			.query(sqlQuery)
		// console.dir(dbTables)
		// console.log(dbTables.recordset.length)
		dbDoc.write('\t<h4>Columns</h4>\n')
		dbDoc.write('\t<ul class="definition definition-columns">\n')
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
			dbDoc.write(`\t\t\t<div>${stringDataType(row)}</div>\n`)
			dbDoc.write('\t\t</li>\n')
			dataColumns.push({ name: row.name, dataType: row.typeName})
		}
		dbDoc.write('\t</ul>\n')
		return dataColumns
	} catch (err) {
		console.log('*** TABLE COLUMNS ERROR ***')
		console.log(err)
	}
}

async function processTable(table) {
	console.log(`Processing Table: ${table.schemaName === 'dbo' ? '' : table.schemaName + '.'}${table.name}`)
	dbDoc.write(`\t<a id="table-${table.schemaName === 'dbo' ? '' : table.schemaName + '-'}${table.name}"></a>\n`)
	dbDoc.write(`\t<h3>${table.schemaName === 'dbo' ? '' : table.schemaName + '.'}${table.name}</h3>\n`)
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
	const tableColumns = await processTableColumns(table.object_id)
	console.log('--Indexes')
	await processTableIndexes(table.object_id)
	console.log('--Foreign Keys')
	await processTableForeignKeys(table.object_id)
	console.log('--Check Constraints')
	await processTableCheckConstraints(table.object_id)
	console.log('--Sample Data')
	await processTableData(table.schemaName, table.name, tableColumns)
	dbDoc.write('\n')
}

async function processTables() {
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
}
async function processObjects() {
	const sqlQuery = `
	SELECT type, type_desc, count(*) AS c
	FROM sys.objects
	GROUP BY type, type_desc;
	`
	const dbObjs = await pool.request()
		.query(sqlQuery)
	// console.dir(dbTables)
	// console.log(dbTables.recordset.length)
	for (const row of dbObjs.recordset) {
		dbObjects[row.type_desc] = row.c
	}
}

async function processDB () {
	const supportedObjects = [
		'USER_TABLE',
		'VIEW',
		'SQL_STORED_PROCEDURE',
		'SQL_SCALAR_FUNCTION'
	]
	try {
		pool = await sql.connect(config)
		await initDoc()
		await processObjects()
		let jumpObjects = 0
		for (const objectType in dbObjects) {
			if (supportedObjects.includes(objectType)) {
				jumpObjects++
			}
		}
		if (jumpObjects === 0) {
			dbDoc.write('\t<h2>No objects found</h2>\n')
		} else {
			if (jumpObjects > 1) {
				writeObjectJump()
			}
			if (dbObjects.USER_TABLE) {
				await processTables()
			}
			if (dbObjects.VIEW) {
				await processViews()
			}
			if (dbObjects.SQL_STORED_PROCEDURE) {
				await processStoredProcedures()
			}
			if (dbObjects.SQL_SCALAR_FUNCTION) {
				await processFunctionsScalar()
			}
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
