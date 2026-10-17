// Barra o deploy se o schema deixar de proteger a tabela `packs` (a lista de pacotes dos usuários).
// Base: o documento do Serverless diz que apagar algo do schema.js não apaga dados, mas também que
// renomear = coluna nova (a antiga fica de fora do schema e os dados não são copiados) e que
// `.deprecated()` marca remoção. Qualquer um dos dois, aqui, faria a lista de pacotes "sumir".
import { readFileSync } from 'node:fs';

const schema = readFileSync(new URL('../tgcloud/schema.js', import.meta.url), 'utf8');
const exigidos = [
  ["export const packs = table('packs'", 'a tabela `packs`'],
  ["integer('id')", 'a coluna `id`'],
  ["integer('user_id')", 'a coluna `user_id`'],
  ["text('name')", 'a coluna `name`'],
  ["text('title')", 'a coluna `title`'],
  ["text('format')", 'a coluna `format`'],
];
const problemas = exigidos.filter(([trecho]) => !schema.includes(trecho)).map(([, nome]) => `falta ${nome}`);
if (/\.deprecated\(/.test(schema)) problemas.push('há `.deprecated()` no schema (marca remoção de dados)');

if (problemas.length) {
  console.error('::error::O schema colocaria os pacotes dos usuários em risco: ' + problemas.join('; ') + '.');
  console.error('Mudanças no schema devem ser só aditivas (novas tabelas/colunas/índices).');
  process.exit(1);
}
console.log('Schema ok: a tabela packs e suas colunas estão preservadas e nada está marcado para remoção.');
