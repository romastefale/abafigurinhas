// Auxiliares da mensagem rica (Bot API 10.3, campo `html`): só `<`, `>`, `&` e `"` precisam de escape.
export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Aviso enviado ao chat depois de criar um pacote ou adicionar uma figurinha a ele. O endereço fica
// sozinho num parágrafo: URLs são detectadas automaticamente e o Telegram abre a tela de adicionar o pacote.
export function avisoDoPacote({ created, title, link }) {
  return `<p><b>${created ? 'Pacote criado' : 'Pacote atualizado'}:</b> ${esc(title)}</p><p>${esc(link)}</p>`;
}
