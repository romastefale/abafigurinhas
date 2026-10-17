// Auxiliares da mensagem rica (Bot API 10.3, campo `html`): só `<`, `>`, `&` e `"` precisam de escape.
export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Aviso enviado ao chat depois de criar um pacote ou adicionar uma figurinha a ele: o nome do pacote
// é um hiperlink (`<a href>`, "Rich HTML style") que aponta para o link do pacote. O `href` passa pelo
// mesmo escape dos atributos (`&quot;`, `&amp;`, `&lt;`, `&gt;` são entidades aceitas).
export function avisoDoPacote({ created, title, link }) {
  return `<h1>${created ? 'Pacote criado' : 'Pacote atualizado'}:</h1><p><a href="${esc(link)}">${esc(title)}</a></p>`;
}
