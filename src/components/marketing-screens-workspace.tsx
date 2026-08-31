"use client";

import Image from "next/image";
import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Copy, Download, Eye, Film, Image as ImageIcon, Layers, Lock, MonitorPlay, Pause, Play, Plus, RotateCcw, Trash2, Type, Unlock, X } from "lucide-react";
import { deleteMarketingProject, duplicateMarketingProject, saveMarketingProject, type FormActionState } from "@/app/admin/actions";
import { cloneTemplateScene, marketingTemplates, type MarketingElement, type MarketingSceneDraft } from "@/lib/marketing-templates";
import { normalizeMasterText, uppercaseMasterName } from "@/lib/master-normalization";

export type MarketingProjectRecord = {
  id: string;
  name: string;
  resolution_preset: "1920x1080" | "1280x720" | "custom";
  width_px: number;
  height_px: number;
  orientation: "landscape" | "portrait";
  duration_total_seconds: number;
  status: "draft" | "active" | "archived";
  updated_at: string;
  scenes: MarketingSceneDraft[];
};

export type MarketingDataSource = {
  id: string;
  label: string;
  kind: "pizza_price" | "sale_product" | "promotion";
  price_cop: number | null;
  image_src?: string | null;
  meta?: string | null;
};

const initialState: FormActionState = { status: "idle", message: "" };

function formatCop(value: number | null | undefined) {
  if (value === null || value === undefined) return "Sin precio";
  return `$ ${new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(value)}`;
}

function newTextElement(): MarketingElement {
  return {
    id: crypto.randomUUID(),
    kind: "text",
    label: "Texto",
    content: "NUEVO TEXTO",
    x: 12,
    y: 12,
    width: 34,
    height: 10,
    zIndex: Date.now(),
    style: { fontFamily: "Inter", fontSize: 54, fontWeight: 800, textAlign: "left", color: "#fff8ed", background: "transparent", opacity: 1, borderRadius: 0, shadow: true },
    animation: { in: "fade", emphasis: "none", out: "none" }
  };
}

function newShapeElement(): MarketingElement {
  return {
    id: crypto.randomUUID(),
    kind: "shape",
    label: "Forma",
    x: 16,
    y: 16,
    width: 28,
    height: 20,
    zIndex: Date.now(),
    style: { background: "rgba(255,255,255,.14)", borderRadius: 20, opacity: 1, borderColor: "rgba(255,255,255,.18)", borderWidth: 1 },
    animation: { in: "appear", emphasis: "none", out: "none" }
  };
}

function sceneFromTemplate(templateId: string) {
  return cloneTemplateScene(marketingTemplates.find((template) => template.id === templateId) ?? marketingTemplates[0]);
}

function blankProject(): MarketingProjectRecord {
  const scene = sceneFromTemplate("visual-menu");
  return {
    id: "",
    name: "TV 1",
    resolution_preset: "1920x1080",
    width_px: 1920,
    height_px: 1080,
    orientation: "landscape",
    duration_total_seconds: scene.duration_seconds,
    status: "draft",
    updated_at: new Date().toISOString(),
    scenes: [scene]
  };
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="primary-button" disabled={pending} type="submit">
      {pending ? "Guardando..." : "Guardar proyecto"}
    </button>
  );
}

export function MarketingScreensWorkspace({ projects, dataSources }: { projects: MarketingProjectRecord[]; dataSources: MarketingDataSource[] }) {
  const [project, setProject] = useState<MarketingProjectRecord>(() => projects[0] ?? blankProject());
  const [query, setQuery] = useState("");
  const [activeSceneId, setActiveSceneId] = useState(project.scenes[0]?.id ?? "");
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [previewSceneIndex, setPreviewSceneIndex] = useState(0);
  const [duplicateName, setDuplicateName] = useState("");
  const [saveState, saveAction] = useActionState(saveMarketingProject, initialState);
  const activeScene = project.scenes.find((scene) => scene.id === activeSceneId) ?? project.scenes[0];
  const selectedElement = activeScene?.elements.find((element) => element.id === selectedElementId) ?? null;
  const filteredProjects = projects.filter((item) => !query || normalizeMasterText(item.name).includes(normalizeMasterText(query)));

  useEffect(() => {
    if (!previewOpen || !playing || project.scenes.length === 0) return;
    const currentScene = project.scenes[previewSceneIndex] ?? project.scenes[0];
    const timeout = window.setTimeout(() => {
      setPreviewSceneIndex((current) => (current + 1) % project.scenes.length);
    }, Math.max(1, currentScene.duration_seconds) * 1000);
    return () => window.clearTimeout(timeout);
  }, [playing, previewOpen, previewSceneIndex, project.scenes]);

  function updateProject(patch: Partial<MarketingProjectRecord>) {
    setProject((current) => ({ ...current, ...patch }));
  }

  function updateScene(sceneId: string, patch: Partial<MarketingSceneDraft>) {
    setProject((current) => ({
      ...current,
      scenes: current.scenes.map((scene) => (scene.id === sceneId ? { ...scene, ...patch } : scene))
    }));
  }

  function updateElement(elementId: string, patch: Partial<MarketingElement>) {
    if (!activeScene) return;
    updateScene(activeScene.id, {
      elements: activeScene.elements.map((element) => (element.id === elementId ? { ...element, ...patch, style: { ...element.style, ...patch.style } } : element))
    });
  }

  function addElement(element: MarketingElement) {
    if (!activeScene) return;
    updateScene(activeScene.id, { elements: [...activeScene.elements, element] });
    setSelectedElementId(element.id);
  }

  function addDataElement(source: MarketingDataSource) {
    const element: MarketingElement = {
      id: crypto.randomUUID(),
      kind: source.kind === "promotion" ? "promotion" : source.kind === "sale_product" ? "dynamic_product" : "dynamic_pizza",
      label: source.label,
      sourceKind: source.kind,
      sourceId: source.id,
      content: source.label,
      x: 56,
      y: 18,
      width: 30,
      height: 42,
      zIndex: Date.now(),
      style: { borderRadius: 24, opacity: 1, shadow: true, color: "#fff8ed", fontSize: 36, fontWeight: 800, textAlign: "center" },
      animation: { in: "zoom", emphasis: "soft_zoom", out: "fade" }
    };
    addElement(element);
  }

  function addScene(templateId = "visual-menu") {
    const scene = sceneFromTemplate(templateId);
    scene.name = `ESCENA ${project.scenes.length + 1}`;
    setProject((current) => ({ ...current, scenes: [...current.scenes, scene] }));
    setActiveSceneId(scene.id);
  }

  function duplicateScene(scene: MarketingSceneDraft) {
    const copy = { ...scene, id: crypto.randomUUID(), name: `${scene.name} COPIA`, elements: scene.elements.map((element) => ({ ...element, id: crypto.randomUUID() })) };
    setProject((current) => ({ ...current, scenes: [...current.scenes, copy] }));
    setActiveSceneId(copy.id);
  }

  function deleteScene(sceneId: string) {
    if (project.scenes.length <= 1) return;
    const next = project.scenes.filter((scene) => scene.id !== sceneId);
    setProject((current) => ({ ...current, scenes: next }));
    setActiveSceneId(next[0]?.id ?? "");
  }

  function projectPayload() {
    return JSON.stringify(project.scenes);
  }

  return (
    <section className="marketing-editor-shell">
      <aside className="marketing-projects-panel">
        <div className="marketing-panel-header">
          <strong>Pantallas</strong>
          <button
            className="icon-button"
            onClick={() => {
              const next = blankProject();
              setProject(next);
              setActiveSceneId(next.scenes[0]?.id ?? "");
              setSelectedElementId(null);
            }}
            title="Nuevo proyecto"
            type="button"
          >
            <Plus size={16} />
          </button>
        </div>
        <input onChange={(event) => setQuery(uppercaseMasterName(event.target.value))} placeholder="Buscar proyecto" value={query} />
        <div className="marketing-project-list">
          {filteredProjects.map((item) => (
            <button
              className={project.id === item.id ? "active" : ""}
              key={item.id}
              onClick={() => {
                setProject(item);
                setActiveSceneId(item.scenes[0]?.id ?? "");
                setSelectedElementId(null);
              }}
              type="button"
            >
              <MonitorPlay size={18} />
              <span>
                <strong>{item.name}</strong>
                <small>{item.width_px}x{item.height_px} · {item.duration_total_seconds}s</small>
              </span>
            </button>
          ))}
          {filteredProjects.length === 0 ? <p className="empty-state">Sin proyectos.</p> : null}
        </div>
        <div className="marketing-template-list">
          <strong>Plantillas</strong>
          {marketingTemplates.map((template) => (
            <button
              key={template.id}
              onClick={() => {
                const scene = sceneFromTemplate(template.id);
                setProject({ ...blankProject(), name: template.name.toUpperCase(), scenes: [scene] });
                setActiveSceneId(scene.id);
                setSelectedElementId(null);
              }}
              type="button"
            >
              <Film size={16} />
              <span>{template.name}</span>
            </button>
          ))}
        </div>
      </aside>

      <form action={saveAction} className="marketing-editor-main">
        <input name="id" type="hidden" value={project.id} />
        <input name="scenes" type="hidden" value={projectPayload()} />
        <header className="marketing-editor-topbar">
          <input name="name" onChange={(event) => updateProject({ name: uppercaseMasterName(event.target.value) })} value={project.name} />
          <select
            name="resolution_preset"
            onChange={(event) => {
              const preset = event.target.value as MarketingProjectRecord["resolution_preset"];
              updateProject({ resolution_preset: preset, width_px: preset === "1280x720" ? 1280 : 1920, height_px: preset === "1280x720" ? 720 : 1080 });
            }}
            value={project.resolution_preset}
          >
            <option value="1920x1080">Full HD 1920x1080</option>
            <option value="1280x720">HD 1280x720</option>
            <option value="custom">Personalizada</option>
          </select>
          <input name="width_px" onChange={(event) => updateProject({ width_px: Number(event.target.value) })} type="number" value={project.width_px} />
          <input name="height_px" onChange={(event) => updateProject({ height_px: Number(event.target.value) })} type="number" value={project.height_px} />
          <select name="status" onChange={(event) => updateProject({ status: event.target.value as MarketingProjectRecord["status"] })} value={project.status}>
            <option value="draft">Borrador</option>
            <option value="active">Activo</option>
            <option value="archived">Archivado</option>
          </select>
          <button className="ghost-button icon-text-button" onClick={() => setPreviewOpen(true)} type="button">
            <Eye size={18} /> Vista previa
          </button>
          <ExportButton />
          <SubmitButton />
        </header>
        {saveState.status !== "idle" ? <p className={`form-status ${saveState.status}`}>{saveState.message}</p> : null}
        <div className="marketing-editor-body">
          <ElementPanel dataSources={dataSources} onAddData={addDataElement} onAddShape={() => addElement(newShapeElement())} onAddText={() => addElement(newTextElement())} />
          <Canvas scene={activeScene} selectedElementId={selectedElementId} setSelectedElementId={setSelectedElementId} updateElement={updateElement} />
          <PropertiesPanel element={selectedElement} scene={activeScene} updateElement={updateElement} updateScene={updateScene} />
        </div>
        <div className="marketing-timeline">
          {project.scenes.map((scene, index) => (
            <button className={scene.id === activeScene?.id ? "active" : ""} key={scene.id} onClick={() => setActiveSceneId(scene.id)} type="button">
              <span>{index + 1}</span>
              <strong>{scene.name}</strong>
              <small>{scene.duration_seconds}s</small>
              <Copy onClick={(event) => { event.stopPropagation(); duplicateScene(scene); }} size={14} />
              <Trash2 onClick={(event) => { event.stopPropagation(); deleteScene(scene.id); }} size={14} />
            </button>
          ))}
          <button className="add-scene-button" onClick={() => addScene()} type="button">
            <Plus size={16} /> Escena
          </button>
        </div>
      </form>

      <aside className="marketing-export-panel">
        <strong>Exportacion</strong>
        <p>La capa de exportacion esta abstraida para MP4 H.264. En esta fase se deja previsualizacion fiel y archivo JSON del proyecto; el render MP4 final queda listo para conectarse a un worker dedicado.</p>
        <button className="ghost-button" onClick={() => downloadJson(project)} type="button">
          <Download size={16} /> Exportar proyecto JSON
        </button>
        <button className="ghost-button" onClick={() => downloadCompatibilityHtml(project.width_px, project.height_px)} type="button">
          <Film size={16} /> Video de prueba HTML
        </button>
        {project.id ? (
          <>
            <input onChange={(event) => setDuplicateName(uppercaseMasterName(event.target.value))} placeholder="Nombre copia" value={duplicateName} />
            <DuplicateProjectForm id={project.id} name={duplicateName} />
            <DeleteProjectForm id={project.id} />
          </>
        ) : null}
      </aside>

      {previewOpen ? (
        <PreviewModal
          playing={playing}
          project={project}
          sceneIndex={previewSceneIndex}
          setPlaying={setPlaying}
          setSceneIndex={setPreviewSceneIndex}
          onClose={() => {
            setPreviewOpen(false);
            setPlaying(false);
          }}
        />
      ) : null}
    </section>
  );
}

function ElementPanel({
  dataSources,
  onAddText,
  onAddShape,
  onAddData
}: {
  dataSources: MarketingDataSource[];
  onAddText: () => void;
  onAddShape: () => void;
  onAddData: (source: MarketingDataSource) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = dataSources.filter((source) => !query || normalizeMasterText(source.label).includes(normalizeMasterText(query))).slice(0, 16);
  return (
    <aside className="marketing-elements-panel">
      <strong>Elementos</strong>
      <button onClick={onAddText} type="button">
        <Type size={18} /> Texto
      </button>
      <button onClick={onAddShape} type="button">
        <Layers size={18} /> Forma
      </button>
      <input onChange={(event) => setQuery(uppercaseMasterName(event.target.value))} placeholder="Pizzas, productos, promos" value={query} />
      <div className="marketing-data-source-list">
        {filtered.map((source) => (
          <button key={`${source.kind}:${source.id}`} onClick={() => onAddData(source)} type="button">
            {source.image_src ? <Image alt={source.label} height={38} src={source.image_src} unoptimized width={48} /> : <ImageIcon size={18} />}
            <span>
              <strong>{source.label}</strong>
              <small>{formatCop(source.price_cop)}</small>
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}

function Canvas({
  scene,
  selectedElementId,
  setSelectedElementId,
  updateElement
}: {
  scene: MarketingSceneDraft | undefined;
  selectedElementId: string | null;
  setSelectedElementId: (id: string | null) => void;
  updateElement: (id: string, patch: Partial<MarketingElement>) => void;
}) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ id: string; startX: number; startY: number; x: number; y: number } | null>(null);
  if (!scene) return <div className="marketing-canvas-wrap" />;
  return (
    <div className="marketing-canvas-wrap">
      <div
        className="marketing-canvas"
        ref={canvasRef}
        style={{ background: scene.background.type === "gradient" ? scene.background.value : scene.background.type === "color" ? scene.background.value : "#17120f" }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag || !canvasRef.current) return;
          const rect = canvasRef.current.getBoundingClientRect();
          updateElement(drag.id, {
            x: Math.min(100, Math.max(0, drag.x + ((event.clientX - drag.startX) / rect.width) * 100)),
            y: Math.min(100, Math.max(0, drag.y + ((event.clientY - drag.startY) / rect.height) * 100))
          });
        }}
        onPointerUp={() => (dragRef.current = null)}
      >
        {scene.elements
          .slice()
          .sort((a, b) => a.zIndex - b.zIndex)
          .map((element) => (
            <button
              className={`marketing-canvas-element ${selectedElementId === element.id ? "selected" : ""} ${element.kind}`}
              key={element.id}
              onPointerDown={(event) => {
                if (element.locked) return;
                setSelectedElementId(element.id);
                dragRef.current = { id: element.id, startX: event.clientX, startY: event.clientY, x: element.x, y: element.y };
              }}
              style={elementStyle(element)}
              type="button"
            >
              {renderElementContent(element)}
            </button>
          ))}
      </div>
    </div>
  );
}

function elementStyle(element: MarketingElement) {
  return {
    left: `${element.x}%`,
    top: `${element.y}%`,
    width: `${element.width}%`,
    height: `${element.height}%`,
    zIndex: element.zIndex,
    color: element.style.color,
    background: element.style.background,
    borderRadius: `${element.style.borderRadius ?? 0}px`,
    opacity: element.style.opacity ?? 1,
    fontSize: `${element.style.fontSize ?? 36}px`,
    fontWeight: element.style.fontWeight ?? 700,
    textAlign: element.style.textAlign ?? "left",
    boxShadow: element.style.shadow ? "0 24px 70px rgba(0,0,0,.35)" : "none",
    border: element.style.borderWidth ? `${element.style.borderWidth}px solid ${element.style.borderColor ?? "transparent"}` : undefined
  } as const;
}

function renderElementContent(element: MarketingElement) {
  if (element.kind === "shape") return null;
  return <span>{element.content ?? element.label}</span>;
}

function PropertiesPanel({
  element,
  scene,
  updateElement,
  updateScene
}: {
  element: MarketingElement | null;
  scene: MarketingSceneDraft | undefined;
  updateElement: (id: string, patch: Partial<MarketingElement>) => void;
  updateScene: (id: string, patch: Partial<MarketingSceneDraft>) => void;
}) {
  if (!scene) return null;
  return (
    <aside className="marketing-properties-panel">
      <strong>Propiedades</strong>
      <label>
        Escena
        <input onChange={(event) => updateScene(scene.id, { name: uppercaseMasterName(event.target.value) })} value={scene.name} />
      </label>
      <label>
        Duracion
        <input min={1} onChange={(event) => updateScene(scene.id, { duration_seconds: Number(event.target.value) })} type="number" value={scene.duration_seconds} />
      </label>
      <label>
        Transicion
        <select onChange={(event) => updateScene(scene.id, { transition: event.target.value as MarketingSceneDraft["transition"] })} value={scene.transition}>
          <option value="cut">Corte</option>
          <option value="fade">Fundido</option>
          <option value="slide">Desplazamiento</option>
        </select>
      </label>
      <label>
        Fondo
        <input onChange={(event) => updateScene(scene.id, { background: { type: "color", value: event.target.value } })} type="color" value={scene.background.type === "color" ? scene.background.value : "#17120f"} />
      </label>
      {element ? (
        <>
          <hr />
          <label>
            Contenido
            <input onChange={(event) => updateElement(element.id, { content: uppercaseMasterName(event.target.value) })} value={element.content ?? ""} />
          </label>
          <div className="marketing-property-grid">
            <label>X<input onChange={(event) => updateElement(element.id, { x: Number(event.target.value) })} type="number" value={Math.round(element.x)} /></label>
            <label>Y<input onChange={(event) => updateElement(element.id, { y: Number(event.target.value) })} type="number" value={Math.round(element.y)} /></label>
            <label>Ancho<input onChange={(event) => updateElement(element.id, { width: Number(event.target.value) })} type="number" value={Math.round(element.width)} /></label>
            <label>Alto<input onChange={(event) => updateElement(element.id, { height: Number(event.target.value) })} type="number" value={Math.round(element.height)} /></label>
          </div>
          <label>
            Color
            <input onChange={(event) => updateElement(element.id, { style: { color: event.target.value } })} type="color" value={element.style.color ?? "#fff8ed"} />
          </label>
          <label>
            Tamano fuente
            <input onChange={(event) => updateElement(element.id, { style: { fontSize: Number(event.target.value) } })} type="range" min={14} max={110} value={element.style.fontSize ?? 36} />
          </label>
          <label>
            Animacion entrada
            <select
              onChange={(event) =>
                updateElement(element.id, {
                  animation: {
                    ...element.animation,
                    in: event.target.value as "none" | "appear" | "fade" | "slide" | "zoom"
                  }
                })
              }
              value={element.animation?.in ?? "none"}
            >
              <option value="none">Sin animacion</option>
              <option value="appear">Aparecer</option>
              <option value="fade">Fade</option>
              <option value="slide">Deslizar</option>
              <option value="zoom">Zoom suave</option>
            </select>
          </label>
          <div className="quick-actions-row">
            <button className="ghost-button compact-action-button" onClick={() => updateElement(element.id, { locked: !element.locked })} type="button">
              {element.locked ? <Unlock size={14} /> : <Lock size={14} />} {element.locked ? "Desbloquear" : "Bloquear"}
            </button>
            <button className="ghost-button compact-action-button" onClick={() => updateElement(element.id, { zIndex: element.zIndex + 1000 })} type="button">Adelante</button>
          </div>
        </>
      ) : <p className="field-hint">Selecciona un elemento del lienzo.</p>}
    </aside>
  );
}

function PreviewModal({
  project,
  sceneIndex,
  playing,
  setPlaying,
  setSceneIndex,
  onClose
}: {
  project: MarketingProjectRecord;
  sceneIndex: number;
  playing: boolean;
  setPlaying: (value: boolean) => void;
  setSceneIndex: (value: number) => void;
  onClose: () => void;
}) {
  const scene = project.scenes[sceneIndex] ?? project.scenes[0];
  return (
    <div className="modal-backdrop">
      <section className="modal-panel marketing-preview-modal">
        <header className="modal-header">
          <strong>Vista previa</strong>
          <button className="icon-button" onClick={onClose} type="button"><X size={18} /></button>
        </header>
        <div className="marketing-preview-stage">
          <Canvas scene={scene} selectedElementId={null} setSelectedElementId={() => undefined} updateElement={() => undefined} />
        </div>
        <div className="form-actions modal-form-actions">
          <button className="ghost-button" onClick={() => setSceneIndex(0)} type="button"><RotateCcw size={16} /> Reiniciar</button>
          <button className="primary-button" onClick={() => setPlaying(!playing)} type="button">{playing ? <Pause size={16} /> : <Play size={16} />} {playing ? "Pausar" : "Reproducir"}</button>
        </div>
      </section>
    </div>
  );
}

function ExportButton() {
  return (
    <button className="ghost-button icon-text-button" onClick={(event) => { event.preventDefault(); alert("Exportacion MP4 preparada para worker dedicado. Usa JSON/HTML de prueba en esta fase."); }} type="button">
      <Download size={18} /> Exportar
    </button>
  );
}

function DuplicateProjectForm({ id, name }: { id: string; name: string }) {
  const [state, action] = useActionState(duplicateMarketingProject, initialState);
  return (
    <form action={action}>
      <input name="id" type="hidden" value={id} />
      <input name="name" type="hidden" value={name} />
      <button className="ghost-button" disabled={!name} type="submit"><Copy size={16} /> Duplicar proyecto</button>
      {state.status !== "idle" ? <p className={`form-status ${state.status}`}>{state.message}</p> : null}
    </form>
  );
}

function DeleteProjectForm({ id }: { id: string }) {
  const [state, action] = useActionState(deleteMarketingProject, initialState);
  return (
    <form action={action}>
      <input name="id" type="hidden" value={id} />
      <button className="ghost-button danger" onClick={(event) => { if (!window.confirm("Eliminar este proyecto?")) event.preventDefault(); }} type="submit"><Trash2 size={16} /> Eliminar</button>
      {state.status !== "idle" ? <p className={`form-status ${state.status}`}>{state.message}</p> : null}
    </form>
  );
}

function downloadJson(project: MarketingProjectRecord) {
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${project.name.replace(/\s+/g, "_") || "MODO_PIZZAS_TV1"}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadCompatibilityHtml(width: number, height: number) {
  const html = `<!doctype html><html><body style="margin:0;background:#111;color:white;font-family:Arial;display:grid;place-items:center;width:100vw;height:100vh"><div style="text-align:center"><h1 style="font-size:90px">MODO PIZZAS</h1><p style="font-size:44px">${width}x${height} · 30 FPS · 10s</p></div></body></html>`;
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "MODO_PIZZAS_VIDEO_PRUEBA.html";
  link.click();
  URL.revokeObjectURL(url);
}
