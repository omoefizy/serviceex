import { app, ipcMain, BrowserWindow } from "electron";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path$1 from "node:path";
import require$$0 from "fs";
import require$$1 from "path";
import require$$2 from "util";
function getDefaultExportFromCjs(x) {
  return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, "default") ? x["default"] : x;
}
var lib = { exports: {} };
var util$1 = {};
util$1.getBooleanOption = (options, key) => {
  let value = false;
  if (key in options && typeof (value = options[key]) !== "boolean") {
    throw new TypeError(`Expected the "${key}" option to be a boolean`);
  }
  return value;
};
util$1.cppdb = Symbol();
util$1.inspect = Symbol.for("nodejs.util.inspect.custom");
let SqliteError$1 = class SqliteError extends Error {
  constructor(message, code) {
    if (typeof code !== "string") {
      throw new TypeError("Expected second argument to be a string");
    }
    super("" + message);
    this.code = code;
    if (typeof Error.captureStackTrace === "function") {
      Error.captureStackTrace(this, SqliteError);
    }
  }
};
Object.defineProperty(SqliteError$1.prototype, "name", {
  value: "SqliteError",
  writable: true,
  enumerable: false,
  configurable: true
});
var sqliteError = SqliteError$1;
var wrappers = {};
var hasRequiredWrappers;
function requireWrappers() {
  if (hasRequiredWrappers) return wrappers;
  hasRequiredWrappers = 1;
  const { cppdb } = util$1;
  wrappers.prepare = function prepare(sql) {
    return this[cppdb].prepare(sql, this, false, false);
  };
  wrappers.exec = function exec(sql) {
    this[cppdb].exec(sql);
    return this;
  };
  wrappers.close = function close() {
    this[cppdb].close();
    return this;
  };
  wrappers.loadExtension = function loadExtension(...args) {
    this[cppdb].loadExtension(...args);
    return this;
  };
  wrappers.defaultSafeIntegers = function defaultSafeIntegers(...args) {
    this[cppdb].defaultSafeIntegers(...args);
    return this;
  };
  wrappers.unsafeMode = function unsafeMode(...args) {
    this[cppdb].unsafeMode(...args);
    return this;
  };
  wrappers.getters = {
    name: {
      get: function name() {
        return this[cppdb].name;
      },
      enumerable: true
    },
    open: {
      get: function open() {
        return this[cppdb].open;
      },
      enumerable: true
    },
    inTransaction: {
      get: function inTransaction() {
        return this[cppdb].inTransaction;
      },
      enumerable: true
    },
    readonly: {
      get: function readonly() {
        return this[cppdb].readonly;
      },
      enumerable: true
    },
    memory: {
      get: function memory() {
        return this[cppdb].memory;
      },
      enumerable: true
    }
  };
  return wrappers;
}
var transaction;
var hasRequiredTransaction;
function requireTransaction() {
  if (hasRequiredTransaction) return transaction;
  hasRequiredTransaction = 1;
  const { cppdb } = util$1;
  const controllers = /* @__PURE__ */ new WeakMap();
  transaction = function transaction2(fn) {
    if (typeof fn !== "function") throw new TypeError("Expected first argument to be a function");
    const db2 = this[cppdb];
    const controller = getController(db2, this);
    const { apply } = Function.prototype;
    const properties = {
      default: { value: wrapTransaction(apply, fn, db2, controller.default) },
      deferred: { value: wrapTransaction(apply, fn, db2, controller.deferred) },
      immediate: { value: wrapTransaction(apply, fn, db2, controller.immediate) },
      exclusive: { value: wrapTransaction(apply, fn, db2, controller.exclusive) },
      database: { value: this, enumerable: true }
    };
    Object.defineProperties(properties.default.value, properties);
    Object.defineProperties(properties.deferred.value, properties);
    Object.defineProperties(properties.immediate.value, properties);
    Object.defineProperties(properties.exclusive.value, properties);
    return properties.default.value;
  };
  const getController = (db2, self) => {
    let controller = controllers.get(db2);
    if (!controller) {
      const shared = {
        commit: db2.prepare("COMMIT", self, false, false),
        rollback: db2.prepare("ROLLBACK", self, false, false),
        savepoint: db2.prepare("SAVEPOINT `	_bs3.	`", self, false, false),
        release: db2.prepare("RELEASE `	_bs3.	`", self, false, false),
        rollbackTo: db2.prepare("ROLLBACK TO `	_bs3.	`", self, false, false)
      };
      controllers.set(db2, controller = {
        default: Object.assign({ begin: db2.prepare("BEGIN", self, false, false) }, shared),
        deferred: Object.assign({ begin: db2.prepare("BEGIN DEFERRED", self, false, false) }, shared),
        immediate: Object.assign({ begin: db2.prepare("BEGIN IMMEDIATE", self, false, false) }, shared),
        exclusive: Object.assign({ begin: db2.prepare("BEGIN EXCLUSIVE", self, false, false) }, shared)
      });
    }
    return controller;
  };
  const wrapTransaction = (apply, fn, db2, { begin, commit, rollback, savepoint, release, rollbackTo }) => function sqliteTransaction() {
    let before, after, undo;
    if (db2.inTransaction) {
      before = savepoint;
      after = release;
      undo = rollbackTo;
    } else {
      before = begin;
      after = commit;
      undo = rollback;
    }
    before.run();
    try {
      const result = apply.call(fn, this, arguments);
      if (result && typeof result.then === "function") {
        throw new TypeError("Transaction function cannot return a promise");
      }
      after.run();
      return result;
    } catch (ex) {
      if (db2.inTransaction) {
        undo.run();
        if (undo !== rollback) after.run();
      }
      throw ex;
    }
  };
  return transaction;
}
var pragma;
var hasRequiredPragma;
function requirePragma() {
  if (hasRequiredPragma) return pragma;
  hasRequiredPragma = 1;
  const { getBooleanOption, cppdb } = util$1;
  pragma = function pragma2(source, options) {
    if (options == null) options = {};
    if (typeof source !== "string") throw new TypeError("Expected first argument to be a string");
    if (typeof options !== "object") throw new TypeError("Expected second argument to be an options object");
    const simple = getBooleanOption(options, "simple");
    const stmt = this[cppdb].prepare(`PRAGMA ${source}`, this, true, false);
    return simple ? stmt.pluck().get() : stmt.all();
  };
  return pragma;
}
var explain;
var hasRequiredExplain;
function requireExplain() {
  if (hasRequiredExplain) return explain;
  hasRequiredExplain = 1;
  const { cppdb } = util$1;
  explain = function explain2(source) {
    if (typeof source !== "string") throw new TypeError("Expected first argument to be a string");
    const stmt = this[cppdb].prepare(`EXPLAIN ${source}`, this, false, true);
    return stmt.all();
  };
  return explain;
}
var backup;
var hasRequiredBackup;
function requireBackup() {
  if (hasRequiredBackup) return backup;
  hasRequiredBackup = 1;
  const fs2 = require$$0;
  const path2 = require$$1;
  const { promisify } = require$$2;
  const { cppdb } = util$1;
  const fsAccess = promisify(fs2.access);
  backup = async function backup2(filename, options) {
    if (options == null) options = {};
    if (typeof filename !== "string") throw new TypeError("Expected first argument to be a string");
    if (typeof options !== "object") throw new TypeError("Expected second argument to be an options object");
    filename = filename.trim();
    const attachedName = "attached" in options ? options.attached : "main";
    const handler = "progress" in options ? options.progress : null;
    if (!filename) throw new TypeError("Backup filename cannot be an empty string");
    if (filename === ":memory:") throw new TypeError('Invalid backup filename ":memory:"');
    if (typeof attachedName !== "string") throw new TypeError('Expected the "attached" option to be a string');
    if (!attachedName) throw new TypeError('The "attached" option cannot be an empty string');
    if (handler != null && typeof handler !== "function") throw new TypeError('Expected the "progress" option to be a function');
    await fsAccess(path2.dirname(filename)).catch(() => {
      throw new TypeError("Cannot save backup because the directory does not exist");
    });
    const isNewFile = await fsAccess(filename).then(() => false, () => true);
    return runBackup(this[cppdb].backup(this, attachedName, filename, isNewFile), handler || null);
  };
  const runBackup = (backup2, handler) => {
    let rate = 0;
    let useDefault = true;
    return new Promise((resolve, reject) => {
      setImmediate(function step() {
        try {
          const progress = backup2.transfer(rate);
          if (!progress.remainingPages) {
            backup2.close();
            resolve(progress);
            return;
          }
          if (useDefault) {
            useDefault = false;
            rate = 100;
          }
          if (handler) {
            const ret = handler(progress);
            if (ret !== void 0) {
              if (typeof ret === "number" && ret === ret) rate = Math.max(0, Math.min(2147483647, Math.round(ret)));
              else throw new TypeError("Expected progress callback to return a number or undefined");
            }
          }
          setImmediate(step);
        } catch (err) {
          backup2.close();
          reject(err);
        }
      });
    });
  };
  return backup;
}
var serialize;
var hasRequiredSerialize;
function requireSerialize() {
  if (hasRequiredSerialize) return serialize;
  hasRequiredSerialize = 1;
  const { cppdb } = util$1;
  serialize = function serialize2(options) {
    if (options == null) options = {};
    if (typeof options !== "object") throw new TypeError("Expected first argument to be an options object");
    const attachedName = "attached" in options ? options.attached : "main";
    if (typeof attachedName !== "string") throw new TypeError('Expected the "attached" option to be a string');
    if (!attachedName) throw new TypeError('The "attached" option cannot be an empty string');
    return this[cppdb].serialize(attachedName);
  };
  return serialize;
}
var _function;
var hasRequired_function;
function require_function() {
  if (hasRequired_function) return _function;
  hasRequired_function = 1;
  const { getBooleanOption, cppdb } = util$1;
  _function = function defineFunction(name, options, fn) {
    if (options == null) options = {};
    if (typeof options === "function") {
      fn = options;
      options = {};
    }
    if (typeof name !== "string") throw new TypeError("Expected first argument to be a string");
    if (typeof fn !== "function") throw new TypeError("Expected last argument to be a function");
    if (typeof options !== "object") throw new TypeError("Expected second argument to be an options object");
    if (!name) throw new TypeError("User-defined function name cannot be an empty string");
    const safeIntegers = "safeIntegers" in options ? +getBooleanOption(options, "safeIntegers") : 2;
    const deterministic = getBooleanOption(options, "deterministic");
    const directOnly = getBooleanOption(options, "directOnly");
    const varargs = getBooleanOption(options, "varargs");
    let argCount = -1;
    if (!varargs) {
      argCount = fn.length;
      if (!Number.isInteger(argCount) || argCount < 0) throw new TypeError("Expected function.length to be a positive integer");
      if (argCount > 100) throw new RangeError("User-defined functions cannot have more than 100 arguments");
    }
    this[cppdb].function(fn, name, argCount, safeIntegers, deterministic, directOnly);
    return this;
  };
  return _function;
}
var aggregate;
var hasRequiredAggregate;
function requireAggregate() {
  if (hasRequiredAggregate) return aggregate;
  hasRequiredAggregate = 1;
  const { getBooleanOption, cppdb } = util$1;
  aggregate = function defineAggregate(name, options) {
    if (typeof name !== "string") throw new TypeError("Expected first argument to be a string");
    if (typeof options !== "object" || options === null) throw new TypeError("Expected second argument to be an options object");
    if (!name) throw new TypeError("User-defined function name cannot be an empty string");
    const start = "start" in options ? options.start : null;
    const step = getFunctionOption(options, "step", true);
    const inverse = getFunctionOption(options, "inverse", false);
    const result = getFunctionOption(options, "result", false);
    const safeIntegers = "safeIntegers" in options ? +getBooleanOption(options, "safeIntegers") : 2;
    const deterministic = getBooleanOption(options, "deterministic");
    const directOnly = getBooleanOption(options, "directOnly");
    const varargs = getBooleanOption(options, "varargs");
    let argCount = -1;
    if (!varargs) {
      argCount = Math.max(getLength(step), inverse ? getLength(inverse) : 0);
      if (argCount > 0) argCount -= 1;
      if (argCount > 100) throw new RangeError("User-defined functions cannot have more than 100 arguments");
    }
    this[cppdb].aggregate(start, step, inverse, result, name, argCount, safeIntegers, deterministic, directOnly);
    return this;
  };
  const getFunctionOption = (options, key, required) => {
    const value = key in options ? options[key] : null;
    if (typeof value === "function") return value;
    if (value != null) throw new TypeError(`Expected the "${key}" option to be a function`);
    if (required) throw new TypeError(`Missing required option "${key}"`);
    return null;
  };
  const getLength = ({ length }) => {
    if (Number.isInteger(length) && length >= 0) return length;
    throw new TypeError("Expected function.length to be a positive integer");
  };
  return aggregate;
}
var table;
var hasRequiredTable;
function requireTable() {
  if (hasRequiredTable) return table;
  hasRequiredTable = 1;
  const { cppdb } = util$1;
  table = function defineTable(name, factory) {
    if (typeof name !== "string") throw new TypeError("Expected first argument to be a string");
    if (!name) throw new TypeError("Virtual table module name cannot be an empty string");
    let eponymous = false;
    if (typeof factory === "object" && factory !== null) {
      eponymous = true;
      factory = defer(parseTableDefinition(factory, "used", name));
    } else {
      if (typeof factory !== "function") throw new TypeError("Expected second argument to be a function or a table definition object");
      factory = wrapFactory(factory);
    }
    this[cppdb].table(factory, name, eponymous);
    return this;
  };
  function wrapFactory(factory) {
    return function virtualTableFactory(moduleName, databaseName, tableName, ...args) {
      const thisObject = {
        module: moduleName,
        database: databaseName,
        table: tableName
      };
      const def = apply.call(factory, thisObject, args);
      if (typeof def !== "object" || def === null) {
        throw new TypeError(`Virtual table module "${moduleName}" did not return a table definition object`);
      }
      return parseTableDefinition(def, "returned", moduleName);
    };
  }
  function parseTableDefinition(def, verb, moduleName) {
    if (!hasOwnProperty.call(def, "rows")) {
      throw new TypeError(`Virtual table module "${moduleName}" ${verb} a table definition without a "rows" property`);
    }
    if (!hasOwnProperty.call(def, "columns")) {
      throw new TypeError(`Virtual table module "${moduleName}" ${verb} a table definition without a "columns" property`);
    }
    const rows = def.rows;
    if (typeof rows !== "function" || Object.getPrototypeOf(rows) !== GeneratorFunctionPrototype) {
      throw new TypeError(`Virtual table module "${moduleName}" ${verb} a table definition with an invalid "rows" property (should be a generator function)`);
    }
    let columns = def.columns;
    if (!Array.isArray(columns) || !isStringArray(columns = [...columns])) {
      throw new TypeError(`Virtual table module "${moduleName}" ${verb} a table definition with an invalid "columns" property (should be an array of strings)`);
    }
    if (columns.length !== new Set(columns).size) {
      throw new TypeError(`Virtual table module "${moduleName}" ${verb} a table definition with duplicate column names`);
    }
    if (!columns.length) {
      throw new RangeError(`Virtual table module "${moduleName}" ${verb} a table definition with zero columns`);
    }
    let parameters;
    if (hasOwnProperty.call(def, "parameters")) {
      parameters = def.parameters;
      if (!Array.isArray(parameters) || !isStringArray(parameters = [...parameters])) {
        throw new TypeError(`Virtual table module "${moduleName}" ${verb} a table definition with an invalid "parameters" property (should be an array of strings)`);
      }
    } else {
      parameters = inferParameters(rows);
    }
    if (parameters.length !== new Set(parameters).size) {
      throw new TypeError(`Virtual table module "${moduleName}" ${verb} a table definition with duplicate parameter names`);
    }
    if (parameters.length > 32) {
      throw new RangeError(`Virtual table module "${moduleName}" ${verb} a table definition with more than the maximum number of 32 parameters`);
    }
    for (const parameter of parameters) {
      if (columns.includes(parameter)) {
        throw new TypeError(`Virtual table module "${moduleName}" ${verb} a table definition with column "${parameter}" which was ambiguously defined as both a column and parameter`);
      }
    }
    let safeIntegers = 2;
    if (hasOwnProperty.call(def, "safeIntegers")) {
      const bool = def.safeIntegers;
      if (typeof bool !== "boolean") {
        throw new TypeError(`Virtual table module "${moduleName}" ${verb} a table definition with an invalid "safeIntegers" property (should be a boolean)`);
      }
      safeIntegers = +bool;
    }
    let directOnly = false;
    if (hasOwnProperty.call(def, "directOnly")) {
      directOnly = def.directOnly;
      if (typeof directOnly !== "boolean") {
        throw new TypeError(`Virtual table module "${moduleName}" ${verb} a table definition with an invalid "directOnly" property (should be a boolean)`);
      }
    }
    const columnDefinitions = [
      ...parameters.map(identifier).map((str) => `${str} HIDDEN`),
      ...columns.map(identifier)
    ];
    return [
      `CREATE TABLE x(${columnDefinitions.join(", ")});`,
      wrapGenerator(rows, new Map(columns.map((x, i) => [x, parameters.length + i])), moduleName),
      parameters,
      safeIntegers,
      directOnly
    ];
  }
  function wrapGenerator(generator, columnMap, moduleName) {
    return function* virtualTable(...args) {
      const output = args.map((x) => Buffer.isBuffer(x) ? Buffer.from(x) : x);
      for (let i = 0; i < columnMap.size; ++i) {
        output.push(null);
      }
      for (const row of generator(...args)) {
        if (Array.isArray(row)) {
          extractRowArray(row, output, columnMap.size, moduleName);
          yield output;
        } else if (typeof row === "object" && row !== null) {
          extractRowObject(row, output, columnMap, moduleName);
          yield output;
        } else {
          throw new TypeError(`Virtual table module "${moduleName}" yielded something that isn't a valid row object`);
        }
      }
    };
  }
  function extractRowArray(row, output, columnCount, moduleName) {
    if (row.length !== columnCount) {
      throw new TypeError(`Virtual table module "${moduleName}" yielded a row with an incorrect number of columns`);
    }
    const offset = output.length - columnCount;
    for (let i = 0; i < columnCount; ++i) {
      output[i + offset] = row[i];
    }
  }
  function extractRowObject(row, output, columnMap, moduleName) {
    let count = 0;
    for (const key of Object.keys(row)) {
      const index = columnMap.get(key);
      if (index === void 0) {
        throw new TypeError(`Virtual table module "${moduleName}" yielded a row with an undeclared column "${key}"`);
      }
      output[index] = row[key];
      count += 1;
    }
    if (count !== columnMap.size) {
      throw new TypeError(`Virtual table module "${moduleName}" yielded a row with missing columns`);
    }
  }
  function inferParameters({ length }) {
    if (!Number.isInteger(length) || length < 0) {
      throw new TypeError("Expected function.length to be a positive integer");
    }
    const params = [];
    for (let i = 0; i < length; ++i) {
      params.push(`$${i + 1}`);
    }
    return params;
  }
  const { hasOwnProperty } = Object.prototype;
  const { apply } = Function.prototype;
  const GeneratorFunctionPrototype = Object.getPrototypeOf(function* () {
  });
  const identifier = (str) => `"${str.replace(/"/g, '""')}"`;
  const defer = (x) => () => x;
  const isStringArray = (arr) => {
    for (let i = 0; i < arr.length; ++i) {
      if (typeof arr[i] !== "string") return false;
    }
    return true;
  };
  return table;
}
var inspect;
var hasRequiredInspect;
function requireInspect() {
  if (hasRequiredInspect) return inspect;
  hasRequiredInspect = 1;
  const DatabaseInspection = function Database2() {
  };
  inspect = function inspect2(depth, opts) {
    return Object.assign(new DatabaseInspection(), this);
  };
  return inspect;
}
const fs = require$$0;
const path = require$$1;
const util = util$1;
const SqliteError2 = sqliteError;
var database = function createDatabase(getAddon, allowNativeBinding) {
  function Database2(filenameGiven, options) {
    if (new.target == null) {
      return new Database2(filenameGiven, options);
    }
    let buffer;
    if (Buffer.isBuffer(filenameGiven)) {
      buffer = filenameGiven;
      filenameGiven = ":memory:";
    }
    if (filenameGiven == null) filenameGiven = "";
    if (options == null) options = {};
    if (typeof filenameGiven !== "string") throw new TypeError("Expected first argument to be a string");
    if (typeof options !== "object") throw new TypeError("Expected second argument to be an options object");
    if ("readOnly" in options) throw new TypeError('Misspelled option "readOnly" should be "readonly"');
    if ("memory" in options) throw new TypeError('Option "memory" was removed in v7.0.0 (use ":memory:" filename instead)');
    const filename = filenameGiven.trim();
    const anonymous = filename === "" || filename === ":memory:";
    const readonly = util.getBooleanOption(options, "readonly");
    const fileMustExist = util.getBooleanOption(options, "fileMustExist");
    const timeout = "timeout" in options ? options.timeout : 5e3;
    const verbose = "verbose" in options ? options.verbose : null;
    const nativeBinding = "nativeBinding" in options ? options.nativeBinding : null;
    if (readonly && anonymous && !buffer) throw new TypeError("In-memory/temporary databases cannot be readonly");
    if (!Number.isInteger(timeout) || timeout < 0) throw new TypeError('Expected the "timeout" option to be a positive integer');
    if (timeout > 2147483647) throw new RangeError('Option "timeout" cannot be greater than 2147483647');
    if (verbose != null && typeof verbose !== "function") throw new TypeError('Expected the "verbose" option to be a function');
    if (!allowNativeBinding && "nativeBinding" in options) throw new TypeError('The "nativeBinding" option is only supported by the default better-sqlite3 entrypoint');
    if (allowNativeBinding && nativeBinding != null && typeof nativeBinding !== "string" && typeof nativeBinding !== "object") throw new TypeError('Expected the "nativeBinding" option to be a string or addon object');
    const addon = getAddon(nativeBinding);
    if (!addon.isInitialized) {
      addon.initialize(SqliteError2, arrayFactory, arrayAppender, rowFactory, recordFactory);
      addon.isInitialized = true;
    }
    if (!anonymous && !filename.startsWith("file:") && !fs.existsSync(path.dirname(filename))) {
      throw new TypeError("Cannot open database because the directory does not exist");
    }
    Object.defineProperties(this, {
      [util.cppdb]: { value: new addon.Database(filename, filenameGiven, anonymous, readonly, fileMustExist, timeout, verbose || null, buffer || null) },
      ...wrappers2.getters
    });
  }
  const wrappers2 = requireWrappers();
  Database2.prototype.prepare = wrappers2.prepare;
  Database2.prototype.transaction = requireTransaction();
  Database2.prototype.pragma = requirePragma();
  Database2.prototype.explain = requireExplain();
  Database2.prototype.backup = requireBackup();
  Database2.prototype.serialize = requireSerialize();
  Database2.prototype.function = require_function();
  Database2.prototype.aggregate = requireAggregate();
  Database2.prototype.table = requireTable();
  Database2.prototype.loadExtension = wrappers2.loadExtension;
  Database2.prototype.exec = wrappers2.exec;
  Database2.prototype.close = wrappers2.close;
  Database2.prototype.defaultSafeIntegers = wrappers2.defaultSafeIntegers;
  Database2.prototype.unsafeMode = wrappers2.unsafeMode;
  Database2.prototype[util.inspect] = requireInspect();
  return Database2;
};
function arrayFactory(...values) {
  return values;
}
function arrayAppender(array, ...values) {
  const offset = array.length;
  for (let i = 0; i < values.length; ++i) {
    array[offset + i] = values[i];
  }
}
function rowFactory(...keys) {
  if (!keys.includes("__proto__")) {
    const parameters = keys.map((_, index) => `v${index}`).join(",");
    const properties = keys.map((key, index) => `${JSON.stringify(key)}:v${index}`).join(",");
    return Function(`return (${parameters}) => ({${properties}})`)();
  }
  return (...values) => {
    const row = {};
    for (let i = 0; i < keys.length; ++i) row[keys[i]] = values[i];
    return row;
  };
}
function recordFactory(value) {
  return { value, done: false };
}
function commonjsRequire(path2) {
  throw new Error('Could not dynamically require "' + path2 + '". Please configure the dynamicRequireTargets or/and ignoreDynamicRequires option of @rollup/plugin-commonjs appropriately for this require call to work.');
}
var binding = { exports: {} };
(function(module, exports) {
  const fs2 = require$$0;
  const path2 = require$$1;
  const PREBUILD_PLATFORMS = ["linux", "darwin", "win32"];
  const PREBUILD_ARCHS = ["x64", "arm64"];
  let DEFAULT_ADDON;
  function getBinding(nativeBinding) {
    if (typeof nativeBinding === "string") {
      const requireFunc = typeof __non_webpack_require__ === "function" ? __non_webpack_require__ : commonjsRequire;
      return requireFunc(path2.resolve(nativeBinding).replace(/(\.node)?$/, ".node"));
    }
    if (typeof nativeBinding === "object" && nativeBinding !== null) {
      return nativeBinding;
    }
    if (DEFAULT_ADDON) {
      return DEFAULT_ADDON;
    }
    let filename = getPrebuildPath();
    if (filename) {
      return DEFAULT_ADDON = commonjsRequire(filename);
    }
    filename = path2.join(__dirname, "..", "build", "Debug", "better_sqlite3.node");
    if (!fs2.existsSync(filename)) {
      filename = path2.join(__dirname, "..", "build", "Release", "better_sqlite3.node");
    }
    return DEFAULT_ADDON = commonjsRequire(filename);
  }
  function getPrebuildPath() {
    if (PREBUILD_PLATFORMS.includes(process.platform) && PREBUILD_ARCHS.includes(process.arch)) {
      const target = `${isLinuxMusl() ? "linuxmusl" : process.platform}-${process.arch}`;
      const filename = path2.join(__dirname, "..", "prebuilds", `${target}.node`);
      if (fs2.existsSync(filename)) {
        return filename;
      }
    }
    return null;
  }
  function isLinuxMusl() {
    return process.platform === "linux" && !process.report.getReport().header.glibcVersionRuntime;
  }
  exports.getBinding = getBinding;
  exports.getPrebuildPath = getPrebuildPath;
  if (require.main === module) {
    process.stdout.write(getPrebuildPath() ? "1" : "0");
  }
})(binding, binding.exports);
var bindingExports = binding.exports;
lib.exports = database(bindingExports.getBinding, true);
lib.exports.SqliteError = sqliteError;
var libExports = lib.exports;
const Database = /* @__PURE__ */ getDefaultExportFromCjs(libExports);
function initSchema(db2) {
  db2.pragma("foreign_keys = ON");
  db2.exec(`
    CREATE TABLE IF NOT EXISTS songs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      author TEXT,
      lyrics TEXT
    );

    CREATE TABLE IF NOT EXISTS slides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
      order_index INTEGER NOT NULL,
      text TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      date TEXT
    );

    CREATE TABLE IF NOT EXISTS service_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      ref_id INTEGER,
      order_index INTEGER NOT NULL
    );
  `);
}
const dbPath = path$1.join(app.getPath("userData"), "worshipdeck.db");
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
initSchema(db);
function splitIntoSlides(lyrics) {
  return lyrics.replace(/\r\n?/g, "\n").split(/\n\s*\n/).map((chunk) => chunk.trim()).filter((chunk) => chunk.length > 0);
}
function replaceSlides(songId, lyrics) {
  db.prepare("DELETE FROM slides WHERE song_id = ?").run(songId);
  const insert = db.prepare("INSERT INTO slides (song_id, order_index, text) VALUES (?, ?, ?)");
  splitIntoSlides(lyrics).forEach((text, index) => insert.run(songId, index, text));
}
function listSongs(search) {
  const query = search == null ? void 0 : search.trim();
  if (!query) {
    return db.prepare("SELECT id, title, author FROM songs ORDER BY title COLLATE NOCASE").all();
  }
  const pattern = `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return db.prepare(
    `SELECT id, title, author FROM songs
       WHERE title LIKE @pattern ESCAPE '\\'
          OR author LIKE @pattern ESCAPE '\\'
          OR lyrics LIKE @pattern ESCAPE '\\'
       ORDER BY title COLLATE NOCASE`
  ).all({ pattern });
}
function getSong(id) {
  return db.prepare("SELECT id, title, author, lyrics FROM songs WHERE id = ?").get(id);
}
const createSong = db.transaction(
  (title, author, lyrics) => {
    const result = db.prepare("INSERT INTO songs (title, author, lyrics) VALUES (?, ?, ?)").run(title, author, lyrics);
    const id = Number(result.lastInsertRowid);
    replaceSlides(id, lyrics);
    return { id, title, author, lyrics };
  }
);
const updateSong = db.transaction(
  (id, title, author, lyrics) => {
    const result = db.prepare("UPDATE songs SET title = ?, author = ?, lyrics = ? WHERE id = ?").run(title, author, lyrics, id);
    if (result.changes === 0) return false;
    replaceSlides(id, lyrics);
    return true;
  }
);
function deleteSong(id) {
  return db.prepare("DELETE FROM songs WHERE id = ?").run(id).changes > 0;
}
function assertId(value) {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError("Song id must be a positive integer");
  }
  return value;
}
function assertSongInput(value) {
  const input = value;
  if (typeof input !== "object" || input === null || typeof input.title !== "string" || input.title.trim() === "" || input.author !== null && typeof input.author !== "string" || typeof input.lyrics !== "string") {
    throw new TypeError("Song needs a non-empty title, an author (string or null) and lyrics");
  }
  return { title: input.title.trim(), author: input.author, lyrics: input.lyrics };
}
function registerSongIpc() {
  ipcMain.handle(
    "songs:list",
    (_event, search) => listSongs(typeof search === "string" ? search : void 0)
  );
  ipcMain.handle("songs:get", (_event, id) => getSong(assertId(id)));
  ipcMain.handle("songs:create", (_event, input) => {
    const { title, author, lyrics } = assertSongInput(input);
    return createSong(title, author, lyrics);
  });
  ipcMain.handle("songs:update", (_event, id, input) => {
    const { title, author, lyrics } = assertSongInput(input);
    return updateSong(assertId(id), title, author, lyrics);
  });
  ipcMain.handle("songs:delete", (_event, id) => deleteSong(assertId(id)));
}
createRequire(import.meta.url);
const __dirname$1 = path$1.dirname(fileURLToPath(import.meta.url));
process.env.APP_ROOT = path$1.join(__dirname$1, "..");
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
const MAIN_DIST = path$1.join(process.env.APP_ROOT, "dist-electron");
const RENDERER_DIST = path$1.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path$1.join(process.env.APP_ROOT, "public") : RENDERER_DIST;
let win;
function createWindow() {
  win = new BrowserWindow({
    icon: path$1.join(process.env.VITE_PUBLIC, "electron-vite.svg"),
    webPreferences: {
      preload: path$1.join(__dirname$1, "preload.mjs")
    }
  });
  win.webContents.on("did-finish-load", () => {
    win == null ? void 0 : win.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
  });
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path$1.join(RENDERER_DIST, "index.html"));
  }
}
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
    win = null;
  }
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
app.whenReady().then(() => {
  registerSongIpc();
  createWindow();
});
export {
  MAIN_DIST,
  RENDERER_DIST,
  VITE_DEV_SERVER_URL
};
