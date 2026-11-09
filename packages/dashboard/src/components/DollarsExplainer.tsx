import { api } from '../lib/api';
import { formatUsd } from '../lib/utils';

const MODELS = [
  ['fable', 'Fable', 'bg-teal-400'],
  ['opus', 'Opus', 'bg-purple-500'],
  ['sonnet', 'Sonnet', 'bg-blue-500'],
  ['haiku', 'Haiku', 'bg-green-500'],
] as const;

const box = 'bg-zinc-900 border border-zinc-800 rounded-lg p-4';
const heading = 'text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3';
const text = 'text-zinc-400 text-xs leading-relaxed';

/** Explains the dollar limit mode, with the team's own price table. */
export function DollarsExplainer() {
  const prices = api.getStoredTeam()?.prices ?? {};
  const price = (n?: number) => (n == null ? '—' : formatUsd(n));

  return (
    <div className="space-y-5 text-sm text-zinc-300">
      <div className={`${box} space-y-2`}>
        <p className={heading}>¿Qué es el límite en dólares?</p>
        <p className={text}>
          En lugar de contar «turnos» con un peso por modelo, el sistema calcula el <span className="text-[#cc5500] font-semibold">costo real estimado</span> de
          cada turno a partir de los <span className="text-zinc-200">tokens que realmente se usaron</span> y el precio de cada modelo. El administrador fija un
          presupuesto en dólares por usuario y por ventana (día, semana o mes).
        </p>
        <p className={text}>
          Son <span className="text-zinc-200">equivalentes a precios de API</span>, no lo que se cobra: la cuenta de Claude es una suscripción compartida. Sirven para
          repartir el consumo entre las personas de forma justa y proporcional a lo que realmente gastan.
        </p>
      </div>

      <div className={box}>
        <p className={heading}>Cómo se calcula un turno</p>
        <p className={`${text} mb-3`}>Cada turno suma cuatro partes, cada una con su precio por millón de tokens:</p>
        <ul className={`${text} space-y-1.5 list-disc pl-4`}>
          <li><span className="text-zinc-200">Entrada</span>: lo que se le envía al modelo (el prompt, los archivos y el historial).</li>
          <li><span className="text-zinc-200">Salida</span>: lo que el modelo responde. Es la parte más cara.</li>
          <li><span className="text-zinc-200">Caché (lectura)</span>: contexto reutilizado de turnos anteriores; es mucho más barato.</li>
          <li><span className="text-zinc-200">Caché (escritura)</span>: contexto que se guarda para reutilizarlo; cuesta algo más que la entrada normal.</li>
        </ul>
        <p className={`${text} mt-3`}>
          Si el turno lanzó <span className="text-zinc-200">subagentes</span>, su parte se valora con el precio del modelo que usó cada uno.
          El <span className="text-zinc-200">effort</span> ya no necesita un multiplicador: un effort alto cuesta más porque el modelo genera más tokens.
        </p>
      </div>

      <div className={box}>
        <p className={heading}>Precios configurados (USD por millón de tokens)</p>
        <div className="space-y-2">
          <div className="grid grid-cols-5 gap-2 text-[10px] uppercase tracking-wider text-zinc-600">
            <span />
            <span className="text-right">Entrada</span>
            <span className="text-right">Salida</span>
            <span className="text-right">Caché lect.</span>
            <span className="text-right">Caché escr.</span>
          </div>
          {MODELS.map(([id, label, color]) => (
            <div key={id} className="grid grid-cols-5 gap-2 items-center py-1 border-b border-zinc-800 last:border-0">
              <div className="flex items-center gap-2"><div className={`w-2 h-2 rounded-full ${color}`} /><span className="font-medium text-zinc-200">{label}</span></div>
              <span className="font-mono text-xs text-zinc-300 text-right">{price(prices[id]?.input)}</span>
              <span className="font-mono text-xs text-zinc-300 text-right">{price(prices[id]?.output)}</span>
              <span className="font-mono text-xs text-zinc-300 text-right">{price(prices[id]?.cache_read)}</span>
              <span className="font-mono text-xs text-zinc-300 text-right">{price(prices[id]?.cache_write)}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-zinc-600 pt-2">
          Se editan en <span className="text-zinc-400">Configuración → Modo de Límites</span>. Si dejas el caché vacío se usa 0.1× (lectura) y 1.25× (escritura) del precio de entrada.
          Un modelo sin precio no cuenta como gratis: se estima con el precio más alto configurado hasta que lo cargues.
        </p>
      </div>

      <div className={box}>
        <p className={heading}>Ejemplo concreto</p>
        <p className={`${text} mb-3`}>
          Con precios <span className="text-zinc-200">ilustrativos</span> de US$3 por millón de entrada y US$15 por millón de salida, un turno que envía
          200 000 tokens y recibe 4 000 cuesta:
        </p>
        <div className="p-2 rounded-md bg-zinc-800/50 border border-zinc-700 text-xs">
          <span className="text-zinc-400">200 000 × US$3 ÷ 1 000 000 = </span><span className="text-zinc-200">US$0.60</span>
          <span className="text-zinc-400"> &nbsp;+&nbsp; 4 000 × US$15 ÷ 1 000 000 = </span><span className="text-zinc-200">US$0.06</span>
          <span className="text-zinc-400"> &nbsp;→&nbsp; </span><span className="text-zinc-200 font-semibold">US$0.66 por turno</span>
        </div>
        <p className={`${text} mt-3`}>
          Con un presupuesto de <span className="text-zinc-200 font-semibold">US$10 por día</span>, ese empleado podría hacer unos 15 turnos de ese tamaño.
          Un turno corto y barato gasta mucho menos, y uno con muchos archivos o con mucha salida, mucho más: lo que se limita es el consumo real, no la cantidad de mensajes.
        </p>
      </div>

      <div className={box}>
        <p className={heading}>¿Qué pasa cuando se agota el presupuesto?</p>
        <p className={text}>
          Cuando el gasto acumulado en la ventana <span className="text-zinc-200">alcanza o supera el presupuesto</span>, Claude Code muestra un mensaje de bloqueo y
          no permite seguir hasta que la ventana se renueve. El costo de un turno se conoce <span className="text-zinc-200">al terminar</span>, así que el último turno
          puede pasarse un poco del presupuesto antes de que se bloquee el siguiente.
        </p>
        <p className={`${text} mt-2`}>
          Se renueva automáticamente según la ventana configurada (día, semana, mes o 24 horas móviles). El historial anterior a cargar los precios solo se valora
          si guardó sus tokens (hooks recientes).
        </p>
      </div>

      <div className={box}>
        <p className={heading}>Capas de control disponibles</p>
        <p className={`${text} mb-3`}>El sistema verifica en este orden — <span className="text-zinc-200">si cualquier condición bloquea, el resto no se evalúa</span>:</p>
        <ol className="space-y-2.5 text-xs">
          <li className="flex gap-3"><span className="text-red-400 font-bold flex-shrink-0 w-5">1.</span><div><span className="text-red-400 font-medium">Estado del usuario</span> — pausado o revocado queda bloqueado.</div></li>
          <li className="flex gap-3"><span className="text-yellow-400 font-bold flex-shrink-0 w-5">2.</span><div><span className="text-yellow-400 font-medium">Restricción horaria</span> — solo en ciertos horarios.</div></li>
          <li className="flex gap-3"><span className="text-orange-400 font-bold flex-shrink-0 w-5">3.</span><div><span className="text-orange-400 font-medium">Modelos permitidos y topes por modelo</span> — un modelo desmarcado queda bloqueado.</div></li>
          <li className="flex gap-3"><span className="text-[#cc5500] font-bold flex-shrink-0 w-5">4.</span><div><span className="text-[#cc5500] font-medium">Presupuesto en dólares</span> — si el gasto de la ventana ya alcanzó el presupuesto, se bloquea.</div></li>
          <li className="flex gap-3"><span className="text-zinc-300 font-bold flex-shrink-0 w-5">5.</span><div><span className="text-zinc-200 font-medium">Effort, subagentes y tokens</span> — topes adicionales por usuario.</div></li>
          <li className="flex gap-3"><span className="text-green-400 font-bold flex-shrink-0 w-5">6.</span><div className="text-green-400 font-medium">Acceso permitido ✓</div></li>
        </ol>
      </div>

      <p className="text-xs text-zinc-600 leading-relaxed">
        El presupuesto se fija por usuario en <span className="text-zinc-400">"Editar Límites"</span>. El modo del equipo y los precios están en{' '}
        <span className="text-zinc-400">Configuración → Modo de Límites</span>; cada usuario puede usar un modo distinto al del equipo.
      </p>
    </div>
  );
}
