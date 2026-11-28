using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.ExtensibleStorage;

namespace Kepler.Revit
{
    // Только элементы с нашей меткой входят в обновление. Сторонние элементы
    // и пользовательские зависимости не удаляются при синхронизации.
    internal sealed class SourceTracking
    {
        private static readonly Guid SchemaId = new("ce45e8a4-7b88-4f44-9877-c06b29a3910c");
        private readonly Document _doc;
        private readonly string _project;
        private readonly Schema _schema;
        private readonly Dictionary<string, Element> _existing = new();
        private readonly HashSet<string> _seen = new();
        private readonly HashSet<string> _duplicates = new();

        public SourceTracking(Document doc, string project)
        {
            _doc = doc; _project = project;
            _schema = Schema.Lookup(SchemaId) ?? CreateSchema();
            foreach (var element in new FilteredElementCollector(doc).WhereElementIsNotElementType())
            {
                var entity = element.GetEntity(_schema);
                if (entity.IsValid() && entity.Get<string>("Project") == project)
                {
                    var source = entity.Get<string>("Source");
                    if (_existing.ContainsKey(source)) _duplicates.Add(source);
                    else _existing[source] = element;
                }
            }
        }

        private static Schema CreateSchema()
        {
            var builder = new SchemaBuilder(SchemaId);
            builder.SetSchemaName("KeplerSourceIdentity");
            builder.SetReadAccessLevel(AccessLevel.Public); builder.SetWriteAccessLevel(AccessLevel.Public);
            foreach (var field in new[] { "Project", "Source", "Fingerprint" }) builder.AddSimpleField(field, typeof(string));
            return builder.Finish();
        }

        public T? Find<T>(string key) where T : Element
        {
            _seen.Add(key);
            if (_duplicates.Contains(key)) throw new InvalidOperationException($"Дубли меток Kepler: {key}. Удалите лишнюю копию или импортируйте отдельно.");
            return _existing.TryGetValue(key, out var element) && element.IsValidObject ? element as T : null;
        }

        public bool Unchanged(Element element, object data)
        {
            var entity = element.GetEntity(_schema);
            return entity.IsValid() && entity.Get<string>("Fingerprint") == JsonSerializer.Serialize(data);
        }

        public void Track(Element element, string key, object data)
        {
            var entity = new Entity(_schema);
            entity.Set("Project", _project); entity.Set("Source", key); entity.Set("Fingerprint", JsonSerializer.Serialize(data));
            element.SetEntity(entity); _seen.Add(key);
        }

        public void RemoveMissing(ImportReport report, bool geometryComplete)
        {
            var ownedIds = _existing.Values.Where(e => e.IsValidObject).Select(e => e.Id).ToHashSet();
            foreach (var pair in _existing.Where(pair => !_seen.Contains(pair.Key)).ToList())
            {
                if (!geometryComplete && pair.Key.StartsWith("geometry/")) continue;
                var element = pair.Value;
                if (!element.IsValidObject) continue;
                if (HasForeignDependents(element,ownedIds,new HashSet<ElementId>()))
                {
                    report.Warn($"{pair.Key}: оставлен, у элемента есть пользовательские зависимости");
                    continue;
                }
                _doc.Delete(element.Id); report.Removed++;
            }
        }

        private bool HasForeignDependents(Element element, HashSet<ElementId> ownedIds, HashSet<ElementId> visited)
        {
            if(!visited.Add(element.Id))return false;
            foreach(var dependent in element.GetDependentElements(null).Select(_doc.GetElement))
            {
                if(dependent==null || dependent.Category==null || dependent is ElementType || dependent is Sketch || dependent is SketchPlane || dependent.Id==element.Id)continue;
                if(!ownedIds.Contains(dependent.Id) || HasForeignDependents(dependent,ownedIds,visited))return true;
            }
            return false;
        }
    }
}
