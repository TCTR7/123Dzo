import {readFile,readdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const normalize=text=>text.replace(/\r\n/g,'\n');
const schema=normalize(await readFile('supabase/schema.sql','utf8'));
const files=(await readdir('supabase/migrations')).filter(name=>name.endsWith('.sql')).sort();
for(const file of files){const migration=normalize(await readFile('supabase/migrations/'+file,'utf8'));assert.ok(schema.includes(migration),'Bootstrap mismatch: '+file);}
assert.equal(new Set(files.map(file=>file.split('_')[0])).size,files.length,'Duplicate migration sequence');
console.log(`PASS: ${files.length} ordered migrations match bootstrap. Database execution is verified separately on disposable PostgreSQL.`);
