// Построение элементов Revit из модели Kepler Plan.
//
// Оси: Kepler — мм, ось Y вниз; Revit — внутренние единицы (футы), Y вверх.
// Стены — по осевым линиям с толщиной (типы «Kepler NNN мм» создаются по
// мере надобности), двери и окна — семейства проекта нужного размера (тип
// дублируется с шириной и высотой), помещения — по центру комнаты, номер
// и имя как в экспликации Kepler.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Text;
using System.Security.Cryptography;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Architecture;
using Autodesk.Revit.DB.Structure;

namespace Kepler.Revit
{
    internal sealed class KeplerImporter
    {
        private readonly Document _doc;
        private readonly ImportReport _report;
        private readonly Dictionary<string, WallType> _wallTypes = new();
        private readonly Dictionary<string, FamilySymbol> _symbols = new();
        private SourceTracking _source = null!;
        private bool _synchronize;
        private List<WallLayerDto> _layers = new();

        public KeplerImporter(Document doc, ImportReport report)
        {
            _doc = doc;
            _report = report;
        }

        private static double Mm(double value) => UnitUtils.ConvertToInternalUnits(value, UnitTypeId.Millimeters);

        // Точка плана Kepler → точка Revit (Y меняет знак).
        private static XYZ P(Pt p, double z = 0) => new XYZ(Mm(p.X), Mm(-p.Y), z);

        public void Import(KeplerExport model, bool synchronize = true)
        {
            _synchronize = synchronize;
            _layers = model.Concept?.Construction?.Config?.Layers ?? new();
            var identity = !string.IsNullOrWhiteSpace(model.Concept?.ProjectId) ? model.Concept.ProjectId : $"legacy:{model.Name}";
            if (!synchronize) identity += ":" + Guid.NewGuid().ToString("N");
            _source = new SourceTracking(_doc, identity);
            foreach (var dto in model.Levels.OrderBy(l => l.Elevation))
            {
                var level = FindOrCreateLevel(dto);
                var hosts = new List<(WallDto Dto, Wall Wall)>();
                foreach (var w in dto.Walls)
                {
                    var wall = CreateWall($"wall/{dto.Id}/{w.Id}", w.From, w.To, w.Thickness, level, w.Height ?? dto.Height, w.Type != "partition", w.BaseOffset, w.Type == "exterior");
                    if (wall != null) hosts.Add((w, wall));
                }
                foreach (var fw in dto.FreeWalls) CreateWall($"free-wall/{dto.Id}/{fw.Id}", fw.From, fw.To, fw.Thickness, level, dto.Height, false);
                _doc.Regenerate();
                foreach (var o in dto.Openings) PlaceOpening(o, hosts, level, dto.Id);
                foreach (var c in dto.Columns) PlaceColumn(c, level, dto.Id);
                _doc.Regenerate();
                foreach (var r in dto.Rooms) PlaceRoom(r, level, dto.Id);
            }
            foreach (var shape in model.ConceptGeometry) PlaceConceptGeometry(shape);
            if (!model.ConceptGeometry.Any()) _report.Warn("Дополнительной геометрии нет: используйте JSON из «Комплекта передачи» для кровли, плит, лестниц и мебели");
            if (_synchronize) _source.RemoveMissing(_report, model.Concept?.GeometryComplete == true);
            SetTrueNorth(model.Building);
        }

        private Level FindOrCreateLevel(LevelDto dto)
        {
            var elevation = Mm(dto.Elevation);
            var sourceKey = $"level/{dto.Id}";
            var own = _source.Find<Level>(sourceKey);
            _source.Find<ViewPlan>($"plan/{dto.Id}");
            if (own != null)
            {
                if (Math.Abs(own.Elevation-elevation) > Mm(.1)) { own.Elevation = elevation; _report.Updated++; }
                _source.Track(own, sourceKey, new { dto.Elevation, dto.Name });
                return own;
            }
            var existing = new FilteredElementCollector(_doc).OfClass(typeof(Level)).Cast<Level>()
                .FirstOrDefault(l => Math.Abs(l.Elevation - elevation) < Mm(1));
            if (existing != null) return existing;
            var level = Level.Create(_doc, elevation);
            // Имя уровня должно быть уникальным: «1 этаж», «1 этаж (Kepler 2)»…
            for (var i = 1; i <= 20; i++)
            {
                try { level.Name = i == 1 ? dto.Name : $"{dto.Name} (Kepler {i})"; break; }
                catch (Autodesk.Revit.Exceptions.ArgumentException) { /* занято — следующее */ }
            }
            // План этажа, чтобы уровень сразу был виден в диспетчере проекта.
            var planType = new FilteredElementCollector(_doc).OfClass(typeof(ViewFamilyType)).Cast<ViewFamilyType>()
                .FirstOrDefault(t => t.ViewFamily == ViewFamily.FloorPlan);
            if (planType != null) _source.Track(ViewPlan.Create(_doc, planType.Id, level.Id), $"plan/{dto.Id}", new { dto.Id });
            _source.Track(level, sourceKey, new { dto.Elevation, dto.Name });
            _report.Levels++;
            return level;
        }

        private WallType? WallTypeFor(double thickness, bool exterior)
        {
            var layered = exterior && _layers.Count > 0 && Math.Abs(_layers.Sum(layer=>layer.Thickness)-thickness)<1;
            var key = Math.Round(thickness).ToString()+(layered?":"+JsonSerializer.Serialize(_layers):"");
            if (_wallTypes.TryGetValue(key, out var cached)) return cached;
            var basic = new FilteredElementCollector(_doc).OfClass(typeof(WallType)).Cast<WallType>()
                .Where(t => t.Kind == WallKind.Basic).ToList();
            var match = !layered ? basic.FirstOrDefault(t => Math.Abs(t.Width - Mm(thickness)) < Mm(1)) : null;
            if (match == null && basic.Count > 0)
            {
                var suffix = layered ? " " + string.Join("+",_layers.Select(layer=>layer.Material)) : "";
                var name = $"Kepler {Math.Round(thickness)} мм{suffix}";
                foreach(var invalid in new[]{"{","}","[","]","|",";","<",">","?"}) name=name.Replace(invalid,"_");
                if(name.Length>160)name=name.Substring(0,160);
                if(layered)name+=" "+Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(key))).Substring(0,12);
                match = basic.FirstOrDefault(t => t.Name == name);
                if (match == null)
                {
                    match = (WallType)basic[0].Duplicate(name);
                    var cs = layered ? CompoundStructure.CreateSimpleCompoundStructure(_layers.Select(layer=>new CompoundStructureLayer(Mm(layer.Thickness),layer.Bearing?MaterialFunctionAssignment.Structure:MaterialFunctionAssignment.Finish1,MaterialFor(layer.Material))).ToList())
                        : CompoundStructure.CreateSingleLayerCompoundStructure(MaterialFunctionAssignment.Structure, Mm(thickness), ElementId.InvalidElementId);
                    match.SetCompoundStructure(cs);
                }
            }
            if (match != null) _wallTypes[key] = match;
            return match;
        }

        private ElementId MaterialFor(string name)
        {
            foreach(var invalid in new[]{"{","}","[","]","|",";","<",">","?",":"}) name=name.Replace(invalid,"_");
            if(string.IsNullOrWhiteSpace(name))name="Kepler материал";
            var material=new FilteredElementCollector(_doc).OfClass(typeof(Material)).Cast<Material>().FirstOrDefault(m=>m.Name==name);
            if(material!=null)return material.Id;
            return Material.Create(_doc,name);
        }

        private Wall? CreateWall(string sourceKey, Pt from, Pt to, double thickness, Level level, double height, bool bearing, double baseOffset = 0, bool exterior = false)
        {
            var a = P(from, level.Elevation + Mm(baseOffset));
            var b = P(to, level.Elevation + Mm(baseOffset));
            if (a.DistanceTo(b) < Mm(10)) return null;
            var type = WallTypeFor(thickness,exterior);
            if (type == null)
            {
                _report.Warn("В проекте нет базовых типов стен — стены не созданы");
                return null;
            }
            var fingerprint = new { from, to, thickness, height, bearing, baseOffset, level = level.UniqueId, type = type.UniqueId };
            var wall = _source.Find<Wall>(sourceKey);
            if (wall != null && _source.Unchanged(wall, fingerprint)) { _report.Unchanged++; return wall; }
            if (wall == null)
            {
                wall = Wall.Create(_doc, Line.CreateBound(a, b), type.Id, level.Id, Mm(height), Mm(baseOffset), false, bearing);
                _report.Walls++;
            }
            else
            {
                wall.ChangeTypeId(type.Id);
                if (wall.Location is LocationCurve curve) curve.Curve = Line.CreateBound(a,b);
                wall.get_Parameter(BuiltInParameter.WALL_BASE_CONSTRAINT)?.Set(level.Id);
                wall.get_Parameter(BuiltInParameter.WALL_BASE_OFFSET)?.Set(Mm(baseOffset));
                wall.get_Parameter(BuiltInParameter.WALL_USER_HEIGHT_PARAM)?.Set(Mm(height));
                _report.Updated++;
            }
            _source.Track(wall, sourceKey, fingerprint);
            return wall;
        }

        // Хозяин проёма — стена с тем же ключом, на отрезке которой лежит центр.
        private static Wall? HostFor(OpeningDto o, List<(WallDto Dto, Wall Wall)> hosts)
        {
            if (o.Center == null) return null;
            var c = o.Center;
            (WallDto Dto, Wall Wall)? best = null;
            var bestDist = double.MaxValue;
            foreach (var h in hosts.Where(h => h.Dto.Key == o.WallKey))
            {
                var dx = h.Dto.To.X - h.Dto.From.X;
                var dy = h.Dto.To.Y - h.Dto.From.Y;
                var len2 = dx * dx + dy * dy;
                if (len2 < 1) continue;
                var t = Math.Clamp(((c.X - h.Dto.From.X) * dx + (c.Y - h.Dto.From.Y) * dy) / len2, 0, 1);
                var px = h.Dto.From.X + t * dx;
                var py = h.Dto.From.Y + t * dy;
                var d = Math.Sqrt((px - c.X) * (px - c.X) + (py - c.Y) * (py - c.Y));
                if (d < bestDist) { bestDist = d; best = h; }
            }
            return best?.Wall;
        }

        // Тип семейства двери/окна нужного размера: дубликат первого подходящего.
        private FamilySymbol? SymbolFor(BuiltInCategory category, double width, double height)
        {
            var key = $"{(int)category}|{Math.Round(width)}|{Math.Round(height)}";
            if (_symbols.TryGetValue(key, out var cached)) return cached;
            var symbols = new FilteredElementCollector(_doc).OfClass(typeof(FamilySymbol)).OfCategory(category)
                .Cast<FamilySymbol>().ToList();
            if (symbols.Count == 0) return null;
            var name = $"Kepler {Math.Round(width)}×{Math.Round(height)}";
            var symbol = symbols.FirstOrDefault(s => s.Name == name);
            if (symbol == null)
            {
                symbol = symbols[0];
                try
                {
                    var copy = (FamilySymbol)symbol.Duplicate(name);
                    var w = copy.get_Parameter(BuiltInParameter.FAMILY_WIDTH_PARAM) ?? copy.LookupParameter("Ширина") ?? copy.LookupParameter("Width");
                    var h = copy.get_Parameter(BuiltInParameter.FAMILY_HEIGHT_PARAM) ?? copy.LookupParameter("Высота") ?? copy.LookupParameter("Height");
                    if (w != null && !w.IsReadOnly) w.Set(Mm(width));
                    if (h != null && !h.IsReadOnly) h.Set(Mm(height));
                    symbol = copy;
                }
                catch (Exception)
                {
                    _report.Warn($"Размер {name}: у семейства «{symbol.FamilyName}» не меняется — взят как есть");
                }
            }
            if (!symbol.IsActive) symbol.Activate();
            _symbols[key] = symbol;
            return symbol;
        }

        private void PlaceOpening(OpeningDto o, List<(WallDto Dto, Wall Wall)> hosts, Level level, string levelKey)
        {
            var isDoor = o.Kind == "door";
            var host = HostFor(o, hosts);
            if (host == null || o.Center == null)
            {
                _report.Warn($"{(isDoor ? "Дверь" : "Окно")} {o.Id}: не найдена стена-хозяин");
                return;
            }
            var sourceKey = $"opening/{levelKey}/{o.Id}/{o.Part}/{o.WallKey}";
            var fingerprint = new { o, level = level.UniqueId, host = host.UniqueId };
            if (o.Part == "upper" || isDoor && o.Type == "none")
            {
                var old = _source.Find<Opening>(sourceKey);
                if (old != null && _source.Unchanged(old, fingerprint)) { _report.Unchanged++; return; }
                if (old != null) _doc.Delete(old.Id);
                var tangent = ((LocationCurve)host.Location).Curve.ComputeDerivatives(.5,true).BasisX.Normalize();
                var center = P(o.Center,level.Elevation+Mm(o.Sill));
                var cut = _doc.Create.NewOpening(host, center-tangent*Mm(o.Width/2), center+tangent*Mm(o.Width/2)+XYZ.BasisZ*Mm(o.Height));
                _source.Track(cut,sourceKey,fingerprint); _report.Voids++; return;
            }
            var fullHeight = o.Part == "lower" && o.SpanTop.HasValue ? o.SpanTop.Value-o.Sill : o.Height;
            var symbol = SymbolFor(isDoor ? BuiltInCategory.OST_Doors : BuiltInCategory.OST_Windows, o.Width, fullHeight);
            if (symbol == null)
            {
                _report.Warn($"В проекте нет семейств {(isDoor ? "дверей" : "окон")} — загрузите их и повторите импорт");
                return;
            }
            var instance = _source.Find<FamilyInstance>(sourceKey);
            if (instance != null && _source.Unchanged(instance,fingerprint)) { _report.Unchanged++; return; }
            if (instance != null && instance.Host?.Id != host.Id)
            {
                _report.Warn($"Проём {o.Id}: стена-хозяин изменилась. Перенесите экземпляр в Revit и повторите обновление."); return;
            }
            if (instance == null) instance = _doc.Create.NewFamilyInstance(P(o.Center, level.Elevation), symbol, host, level, StructuralType.NonStructural);
            else { instance.Symbol=symbol; if (instance.Location is LocationPoint location) location.Point=P(o.Center,level.Elevation+Mm(o.Sill)); _report.Updated++; }
            if (!isDoor)
            {
                var sill = instance.get_Parameter(BuiltInParameter.INSTANCE_SILL_HEIGHT_PARAM);
                if (sill != null && !sill.IsReadOnly) sill.Set(Mm(o.Sill));
                _report.Windows++;
            }
            else
            {
                _report.Doors++;
            }
            if (isDoor)
            {
                if (o.HingeStart.HasValue && instance.CanFlipHand && instance.HandFlipped != !o.HingeStart.Value) instance.flipHand();
                if (o.SwingIn.HasValue && instance.CanFlipFacing && instance.FacingFlipped != !o.SwingIn.Value) instance.flipFacing();
            }
            _source.Track(instance,sourceKey,fingerprint);
        }

        private void PlaceColumn(ColumnDto c, Level level, string levelKey)
        {
            var symbol = new FilteredElementCollector(_doc).OfClass(typeof(FamilySymbol)).OfCategory(BuiltInCategory.OST_Columns)
                .Cast<FamilySymbol>().FirstOrDefault();
            if (symbol == null)
            {
                _report.Warn("В проекте нет семейств колонн — колонны пропущены");
                return;
            }
            if (!symbol.IsActive) symbol.Activate();
            var point = P(c.Center, level.Elevation);
            var sourceKey=$"column/{levelKey}/{c.Id}";
            var fingerprint=new { c, level=level.UniqueId };
            var instance=_source.Find<FamilyInstance>(sourceKey);
            if(instance!=null && _source.Unchanged(instance,fingerprint)){_report.Unchanged++;return;}
            if(instance==null) instance = _doc.Create.NewFamilyInstance(point, symbol, level, StructuralType.NonStructural);
            else { if(instance.Location is LocationPoint lp) lp.Point=point; _report.Updated++; }
            if (instance.Location is LocationPoint)
            {
                // По часовой на плане Kepler = против часовой в Revit.
                var axis = Line.CreateBound(point, point + XYZ.BasisZ);
                var current = instance.Location is LocationPoint lp ? lp.Rotation : 0;
                ElementTransformUtils.RotateElement(_doc, instance.Id, axis, -c.RotationDeg * Math.PI / 180-current);
            }
            _report.Columns++;
            _source.Track(instance,sourceKey,fingerprint);
        }

        private void PlaceRoom(RoomDto r, Level level, string levelKey)
        {
            if (r.Void || r.Polygon.Count == 0) return;
            var cx = r.LabelPoint?.X ?? r.Polygon.Average(p => p.X);
            var cy = r.LabelPoint?.Y ?? r.Polygon.Average(p => p.Y);
            var sourceKey=$"room/{levelKey}/{r.Id}";
            var fingerprint=JsonSerializer.Serialize(new {r, level=level.UniqueId});
            var room = _source.Find<Room>(sourceKey);
            if(room!=null && _source.Unchanged(room,fingerprint)){_report.Unchanged++;return;}
            if(room==null) room = _doc.Create.NewRoom(level, new UV(Mm(cx), Mm(-cy)));
            else if(room.Location is LocationPoint location) { location.Move(new XYZ(Mm(cx),Mm(-cy),level.Elevation)-location.Point); _report.Updated++; }
            if (room == null)
            {
                _report.Warn($"Помещение «{r.Name}»: не удалось создать");
                return;
            }
            room.Name = r.Name;
            if (!string.IsNullOrEmpty(r.Number))
            {
                try { room.Number = r.Number; } catch (Exception) { _report.Warn($"Номер {r.Number} уже занят"); }
            }
            var top = room.get_Parameter(BuiltInParameter.ROOM_UPPER_OFFSET);
            if (top != null && !top.IsReadOnly && r.CeilingHeight > 0) top.Set(Mm(r.CeilingHeight));
            _report.Rooms++;
            _source.Track(room,sourceKey,fingerprint);
        }

        private void PlaceConceptGeometry(ConceptGeometryDto dto)
        {
            var sourceKey=$"geometry/{dto.Id}";
            var existing=_source.Find<DirectShape>(sourceKey);
            if(existing!=null && _source.Unchanged(existing,dto)){_report.Unchanged++;return;}
            using var sub=new SubTransaction(_doc);
            sub.Start();
            try
            {
                var builder=new TessellatedShapeBuilder { Target=TessellatedShapeBuilderTarget.AnyGeometry, Fallback=TessellatedShapeBuilderFallback.Mesh };
                builder.OpenConnectedFaceSet(false);
                foreach(var face in dto.Faces)
                {
                    if(face.Count<3)continue;
                    var vertices=face.Select(p=>new XYZ(Mm(p.X),Mm(-p.Y),Mm(p.Z))).Reverse().ToList();
                    var tessellated=new TessellatedFace(vertices,ElementId.InvalidElementId);
                    if(builder.DoesFaceHaveEnoughLoopsAndVertices(tessellated))builder.AddFace(tessellated);
                }
                builder.CloseConnectedFaceSet();builder.Build();
                var category=dto.Category switch {"floor"=>BuiltInCategory.OST_Floors,"roof"=>BuiltInCategory.OST_Roofs,"stairs"=>BuiltInCategory.OST_Stairs,"furniture"=>BuiltInCategory.OST_Furniture,_=>BuiltInCategory.OST_GenericModel};
                var categoryId=new ElementId(category);
                if(!DirectShape.IsValidCategoryId(categoryId,_doc))categoryId=new ElementId(BuiltInCategory.OST_GenericModel);
                var geometry=builder.GetBuildResult().GetGeometricalObjects();
                if(geometry.Count==0)throw new InvalidOperationException("Нет допустимых граней");
                var shape=existing??DirectShape.CreateElement(_doc,categoryId);
                shape.ApplicationId="Kepler";shape.ApplicationDataId=dto.Id;
                shape.SetShape(geometry);
                _source.Track(shape,sourceKey,dto);_report.Shapes++;if(existing!=null)_report.Updated++;
                sub.Commit();
            }
            catch(Exception error){sub.RollBack();_report.Warn($"Геометрия {dto.Id}: {error.Message}");}
        }

        // Истинный север: в Kepler — угол по часовой от «вверх» плана дома.
        // ProjectPosition.Angle в Revit — угол от истинного севера к северу
        // проекта (против часовой положителен), поэтому знак меняется.
        private void SetTrueNorth(BuildingDto? building)
        {
            if (building == null) return;
            var location = _doc.ActiveProjectLocation;
            var position = location.GetProjectPosition(XYZ.Zero);
            var angle = -building.TrueNorthDeg * Math.PI / 180;
            location.SetProjectPosition(XYZ.Zero, new ProjectPosition(position.EastWest, position.NorthSouth, position.Elevation, angle));
        }
    }
}
