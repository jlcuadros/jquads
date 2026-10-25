/**
 * Spanish UI texts — the reference language: every other language must have
 * exactly the same keys (enforced by the `Messages` type in i18n.ts).
 *
 * Conventions:
 *   - {name} placeholders are filled by t(key, { name: value }).
 *   - Keys ending in ".html" may contain markup (<b>, links) and are inserted
 *     with innerHTML; all other texts are plain text.
 *   - ".one" / ".many" variants exist where the grammar depends on how many
 *     moves are mentioned (Spanish "la" / "las").
 */
export const es = {
  // --- Top line and buttons -------------------------------------------------
  'btn.hide': 'Ocultar jugadas',
  'btn.show': 'Mostrar jugadas',
  'btn.flip': 'Girar tablero',
  'btn.lichess': 'Abrir en Lichess',
  'btn.menu': 'Ajustes y ayuda',
  'nav.first': 'Inicio',
  'nav.prev': 'Anterior',
  'nav.next': 'Siguiente',
  'nav.last': 'Final',

  // --- Settings (⚙) ---------------------------------------------------------
  'set.lang': 'Idioma',
  'set.elo': 'Elo de Maia',
  'set.depth': 'Profundidad Stockfish',
  'set.threatDepth': 'Profundidad amenazas',
  'set.hash': 'Memoria Stockfish (hash)',
  'set.variant': 'Versión Stockfish',
  'set.variant.sf17': '17 NNUE (más fuerte, ~80 MB)',
  'set.variant.sfhce': 'Clásico (ligero, menos preciso)',
  'set.lines': 'Jugadas por motor',
  'set.threats': 'Amenazas',
  'set.threats.bar': 'Barra y jugadas',
  'set.threats.moves': 'Solo jugadas',
  'set.threats.off': 'No calcular',
  'set.notation': 'Notación',
  'set.notation.figurine': 'Figuras (♘f3)',
  'set.notation.letters': 'Letras (Nf3)',
  'set.evalBar': 'Barra de evaluación junto al tablero',
  'set.tablebase': 'Tablas de finales en línea (Lichess, ≤ 7 piezas)',
  'set.editPosition': 'Introducir posición',
  'set.loadFen': 'Cargar FEN',
  'set.newGame': 'Nueva partida',
  'set.exportPgn': 'Exportar PGN',

  // --- Help -------------------------------------------------------------------
  'help.title': 'Cómo se lee la pantalla',
  'help.top.html': '<b>Línea de arriba</b>: probabilidad de que ganen las blancas según Maia (rojo) y evaluación de Stockfish con su profundidad (azul). <b>🙈</b> oculta las jugadas (salen como «--») pero deja las evaluaciones, para entrenar; con las jugadas ocultas el botón es <b>💡</b>: púlsalo para volver a verlas.',
  'help.arrows.html': '<b>Flechas</b>: roja = jugada más humana (Maia); azul = mejor jugada (Stockfish); naranja = amenaza (la mejor jugada del rival si le tocara mover). Si la roja y la azul coinciden, la roja va dentro de la azul.',
  'help.bar1.html': '<b>1ª barra — jugadas</b>: cómo se reparte la probabilidad de Maia (lo que jugaría un humano de ese Elo) entre jugadas buenas ✓, imprecisiones ?! y errores ??.',
  'help.bar2.html': '<b>2ª barra — amenazas</b>: lo mismo para el rival si le tocara mover a él (como si el bando que mueve pasara turno). No se calcula si hay jaque. Va marcada con un borde naranja (el color de la flecha de amenaza) y sus jugadas llevan triángulos de color en vez de círculos. En ajustes se puede ver como barra y jugadas, solo las jugadas, o no calcularla.',
  'help.colors.html': '<b>Colores</b>: según cuánta probabilidad de ganar se pierde frente a la mejor jugada de Stockfish: verde &lt; 5 %, amarillo 5–10 %, rojo ≥ 10 %. Cuanto más oscuro el verde, mejor; cuanto más oscuro el rojo, peor.',
  'help.tablebase.html': '<b>Tablas de finales</b>: con 7 piezas o menos (reyes incluidos) y sin enroques, el resultado exacto viene de las tablas Syzygy de Lichess en vez de Stockfish: arriba «TB …» y la columna derecha «Tablas Syzygy» con «Gana M12» (mate en 12), «Tablas» o «Pierde». Se puede desactivar en esta pantalla; si fallan o no hay conexión, se usa Stockfish.',
  'help.evalBar.html': '<b>Barra vertical</b> (opcional): blanco/negro según la evaluación de Stockfish; la marca roja es la probabilidad de victoria de las blancas según Maia.',
  'help.pgn.html': '<b>Exportar PGN</b>: la partida con sus variantes; se puede copiar o enviar a otra app (para Lichess: pegarla en lichess.org/paste). <b>↗Li</b> abre la posición actual en Lichess.',
  'help.memory.html': '<b>Memoria</b>: el hash de Stockfish sirve para el análisis y para las amenazas (es el mismo motor). La versión clásica ahorra unos 80 MB de redes neuronales; cambiarla recarga la página.',

  // --- Credits ----------------------------------------------------------------
  'credits.title': 'Créditos y licencias',
  'credits.source.html': '<b>Código fuente</b> (AGPL-3.0): <a href="https://github.com/jlcuadros/maia-stockfish-analysis" target="_blank" rel="noopener">github.com/jlcuadros/maia-stockfish-analysis</a>',
  'credits.author.html': '<b>Creado por José Luis Cuadros.</b> ¿Ideas, fallos o te apetece jugar? Mándame una solicitud de amistad en <a href="https://lichess.org/@/Ousland" target="_blank" rel="noopener">Lichess (Ousland)</a> o contáctame por <a href="https://www.linkedin.com/in/jose-luis-cuadros-fernandez/" target="_blank" rel="noopener">LinkedIn</a>.',
  'credits.maia.html': 'Uso personal, no oficial. Basado en <a href="https://www.maiachess.com" target="_blank" rel="noopener">maiachess.com</a> (<a href="https://github.com/CSSLab/maia-platform-frontend" target="_blank" rel="noopener">código</a>, GPL-3.0) del CSSLab de la Universidad de Toronto.',
  'credits.model.html': 'Modelo <a href="https://github.com/CSSLab/maia3" target="_blank" rel="noopener">Maia-3</a> (CSSLab). Investigación: <a href="https://arxiv.org/abs/2605.19091" target="_blank" rel="noopener">Maia-3</a> (ICLR 2026), <a href="https://www.cs.toronto.edu/~ashton/pubs/maia2-neurips2024.pdf" target="_blank" rel="noopener">Maia-2</a> (NeurIPS 2024), <a href="https://arxiv.org/abs/2006.01855" target="_blank" rel="noopener">Maia</a> (KDD 2020).',
  'credits.design': 'El diseño del panel de análisis, el código de colores y la forma de ejecutar Maia en el navegador están tomados de maiachess.com.',
  'credits.stockfish.html': '<a href="https://stockfishchess.org" target="_blank" rel="noopener">Stockfish</a> (GPL-3.0), compilado para web por Lichess: <a href="https://github.com/lichess-org/lila-stockfish-web" target="_blank" rel="noopener">lila-stockfish-web</a> (AGPL-3.0).',
  'credits.libs.html': 'Tablero <a href="https://github.com/lichess-org/chessground" target="_blank" rel="noopener">chessground</a> (GPL-3.0), reglas <a href="https://github.com/jhlywa/chess.js" target="_blank" rel="noopener">chess.js</a> (BSD-2), <a href="https://github.com/microsoft/onnxruntime" target="_blank" rel="noopener">onnxruntime-web</a> (MIT), tablas de finales <a href="https://lichess.org/api#tag/Tablebase" target="_blank" rel="noopener">Lichess</a>.',
  'credits.link': 'Ver créditos: ⚙ > Créditos y licencias',

  // --- Panel ------------------------------------------------------------------
  'panel.calculating': 'calculando…',
  'panel.prob': 'prob',
  'panel.eval': 'eval',
  'panel.result': 'resultado',
  'panel.tablebase': 'Tablas',
  'panel.sfClassic': 'SF clásico',
  'panel.noMoves': 'Mueve una pieza para empezar',
  'panel.threatsInCheck': 'Amenazas: no se calculan con el rey en jaque',
  'panel.tbExact': 'Tablas de finales (resultado exacto):',
  'panel.checkmate': 'Jaque mate.',
  'panel.draw': 'Tablas.',
  'meter.main': 'Jugadas según Maia',
  'meter.threats': 'Amenazas (si moviera el rival)',

  // --- Endgame tables -----------------------------------------------------------
  'tb.draw': 'tablas', // top line: "TB tablas"
  'tb.win': 'gana', // top line when the mate distance is unknown: "TB +gana"
  'tb.label.win': 'Gana',
  'tb.label.loss': 'Pierde',
  'tb.label.draw': 'Tablas',
  'tb.label.draw50': 'Tablas (50 j.)',

  // --- Explanatory text (analysis/describe.ts) -----------------------------------
  'd.mate.white': 'Hay mate en {n} para las blancas.',
  'd.mate.black': 'Hay mate en {n} para las negras.',
  'd.balanced': 'La posición está equilibrada.',
  'd.slight.white': 'Las blancas tienen una ligera ventaja ({score}).',
  'd.slight.black': 'Las negras tienen una ligera ventaja ({score}).',
  'd.clear.white': 'Las blancas tienen una ventaja clara ({score}).',
  'd.clear.black': 'Las negras tienen una ventaja clara ({score}).',
  'd.decisive.white': 'Las blancas tienen una ventaja decisiva ({score}).',
  'd.decisive.black': 'Las negras tienen una ventaja decisiva ({score}).',
  'd.good.one': 'Solo hay una jugada buena: ',
  'd.good.many': 'Las jugadas buenas son ',
  'd.and': ' y ',
  'd.easy.one': ', y un jugador de {elo} la encontraría sin problema ({pct}). ',
  'd.easy.many': ', y un jugador de {elo} las encontraría sin problema ({pct}). ',
  'd.medium.one': ', aunque no es evidente: un jugador de {elo} acertaría el {pct} de las veces. ',
  'd.medium.many': ', aunque no son evidentes: un jugador de {elo} acertaría el {pct} de las veces. ',
  'd.hard.one': ', pero es difícil de ver: un jugador de {elo} solo acertaría el {pct} de las veces. ',
  'd.hard.many': ', pero son difíciles de ver: un jugador de {elo} solo acertaría el {pct} de las veces. ',
  'd.careful': 'Cuidado con ',
  'd.tempting.blunder': ': la jugaría el {pct} pero es un error grave ({score}). ',
  'd.tempting.ok': ': la jugaría el {pct} pero es una imprecisión ({score}). ',

  // --- Position editor ----------------------------------------------------------
  'ed.title': 'Introducir posición',
  'ed.cancel': 'Cancelar',
  'ed.apply': 'Analizar',
  'ed.turn': 'Turno',
  'ed.white': 'Blancas',
  'ed.black': 'Negras',
  'ed.castling': 'Enroques:',
  'ed.start': 'Posición inicial',
  'ed.clear': 'Vaciar',
  'ed.flip': 'Girar',
  'ed.hint.move': 'Arrastra las piezas. Sácalas del tablero para quitarlas.',
  'ed.hint.piece': 'Toca casillas para poner la pieza (o arrástrala desde aquí).',
  'ed.hint.erase': 'Toca piezas para quitarlas.',
  'ed.err.whiteKing': 'Tiene que haber exactamente un rey blanco.',
  'ed.err.blackKing': 'Tiene que haber exactamente un rey negro.',
  'ed.err.pawnRank': 'No puede haber peones en la primera ni en la última fila.',
  'ed.err.pawnCount': 'No puede haber más de 8 peones de un color.',
  'ed.err.blackInCheck': 'El rey negro está en jaque pero les toca mover a las blancas.',
  'ed.err.whiteInCheck': 'El rey blanco está en jaque pero les toca mover a las negras.',
  'ed.err.invalid': 'Posición no válida: {detail}',

  // --- Messages -----------------------------------------------------------------
  'msg.loading': 'Cargando motores… {pct}%',
  'msg.loadError': 'Error cargando los motores: {detail}',
  'msg.pgnCopied': 'PGN copiado al portapapeles',
  'msg.invalidFen': 'FEN no válido',
  'pgn.title': 'Partida (jquads)',
  'pgn.event': 'Análisis',

  // --- Lichess games (📂) ------------------------------------------------------
  'btn.games': 'Partidas de Lichess',
  'games.title': 'Partidas de Lichess',
  'games.close': 'Cerrar',
  'games.user': 'Usuario de Lichess',
  'games.load': 'Cargar',
  'games.tab.recent': 'Recientes',
  'games.tab.favorites': '⭐ Favoritas',
  'games.speed.bullet': 'Bullet',
  'games.speed.blitz': 'Blitz',
  'games.speed.rapid': 'Rápida',
  'games.speed.classical': 'Clásica',
  'games.speed.correspondence': 'Correspondencia',
  'games.from': 'Desde',
  'games.to': 'Hasta',
  'games.more': 'Cargar más',
  'games.loading': 'Descargando partidas…',
  'games.empty': 'No hay partidas con estos filtros.',
  'games.noFavorites': 'Aún no tienes favoritas: toca ☆ en una partida.',
  'games.needUser': 'Escribe tu usuario de Lichess.',
  'games.err.notFound': 'No existe el usuario «{user}» en Lichess.',
  'games.err.rateLimited': 'Lichess pide esperar un minuto antes de seguir.',
  'games.err.network': 'No se pudieron descargar las partidas ({detail}). Si has descargado muchas seguidas, Lichess hace esperar un minuto: vuelve a intentarlo después.',
  'games.favorite': 'Añadir a favoritas',
  'games.unfavorite': 'Quitar de favoritas',
  'games.casual': 'amistosa',
  'help.games.html': '<b>📂 Partidas de Lichess</b>: escribe tu usuario una vez y verás tus partidas, de la más reciente a la más antigua, con filtros por ritmo y fecha. Toca una para analizarla (empieza en la posición inicial, con el tablero de tu color). La ☆ la guarda en favoritas (en este dispositivo).',
} as const
