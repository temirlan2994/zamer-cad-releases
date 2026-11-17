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
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Architecture;
using Autodesk.Revit.DB.Structure;

namespace Kepler.Revit
{
    internal sealed class KeplerImporter
    {
        private readonly Document _doc;
        private readonly ImportReport _report;
        private readonly Dictionary<long, WallType> _wallTypes = new();
        private readonly Dictionary<string, FamilySymbol> _symbols = new();

        public KeplerImporter(Document doc, ImportReport report)
        {
            _doc = doc;
            _report = report;
        }

        private static double Mm(double value) => UnitUtils.ConvertToInternalUnits(value, UnitTypeId.Millimeters);

        // Точка плана Kepler → точка Revit (Y меняет знак).
        private static XYZ P(Pt p, double z = 0) => new XYZ(Mm(p.X), Mm(-p.Y), z);

        public void Import(KeplerExport model)
        {
            foreach (var dto in model.Levels.OrderBy(l => l.Elevation))
            {
                var level = FindOrCreateLevel(dto);
                var hosts = new List<(WallDto Dto, Wall Wall)>();
                foreach (var w in dto.Walls)
                {
                    var wall = CreateWall(w.From, w.To, w.Thickness, level, dto.Height, w.Type == "bearing");
                    if (wall != null) hosts.Add((w, wall));
                }
                foreach (var fw in dto.FreeWalls) CreateWall(fw.From, fw.To, fw.Thickness, level, dto.Height, false);
                _doc.Regenerate();
                foreach (var o in dto.Openings) PlaceOpening(o, hosts, level);
                foreach (var c in dto.Columns) PlaceColumn(c, level);
                _doc.Regenerate();
                foreach (var r in dto.Rooms) PlaceRoom(r, level);
            }
            SetTrueNorth(model.Building);
        }

        private Level FindOrCreateLevel(LevelDto dto)
        {
            var elevation = Mm(dto.Elevation);
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
            if (planType != null) ViewPlan.Create(_doc, planType.Id, level.Id);
            _report.Levels++;
            return level;
        }

        private WallType? WallTypeFor(double thickness)
        {
            var key = (long)Math.Round(thickness);
            if (_wallTypes.TryGetValue(key, out var cached)) return cached;
            var basic = new FilteredElementCollector(_doc).OfClass(typeof(WallType)).Cast<WallType>()
                .Where(t => t.Kind == WallKind.Basic).ToList();
            var match = basic.FirstOrDefault(t => Math.Abs(t.Width - Mm(thickness)) < Mm(1));
            if (match == null && basic.Count > 0)
            {
                var name = $"Kepler {key} мм";
                match = basic.FirstOrDefault(t => t.Name == name);
                if (match == null)
                {
                    match = (WallType)basic[0].Duplicate(name);
                    var cs = CompoundStructure.CreateSingleLayerCompoundStructure(
                        MaterialFunctionAssignment.Structure, Mm(thickness), ElementId.InvalidElementId);
                    match.SetCompoundStructure(cs);
                }
            }
            if (match != null) _wallTypes[key] = match;
            return match;
        }

        private Wall? CreateWall(Pt from, Pt to, double thickness, Level level, double height, bool bearing)
        {
            var a = P(from, level.Elevation);
            var b = P(to, level.Elevation);
            if (a.DistanceTo(b) < Mm(10)) return null;
            var type = WallTypeFor(thickness);
            if (type == null)
            {
                _report.Warn("В проекте нет базовых типов стен — стены не созданы");
                return null;
            }
            var wall = Wall.Create(_doc, Line.CreateBound(a, b), type.Id, level.Id, Mm(height), 0, false, bearing);
            _report.Walls++;
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

        private void PlaceOpening(OpeningDto o, List<(WallDto Dto, Wall Wall)> hosts, Level level)
        {
            var isDoor = o.Kind == "door";
            if (isDoor && o.Type == "none") return; // проём без двери — просто разрыв
            var host = HostFor(o, hosts);
            if (host == null || o.Center == null)
            {
                _report.Warn($"{(isDoor ? "Дверь" : "Окно")} {o.Id}: не найдена стена-хозяин");
                return;
            }
            var symbol = SymbolFor(isDoor ? BuiltInCategory.OST_Doors : BuiltInCategory.OST_Windows, o.Width, o.Height);
            if (symbol == null)
            {
                _report.Warn($"В проекте нет семейств {(isDoor ? "дверей" : "окон")} — загрузите их и повторите импорт");
                return;
            }
            var instance = _doc.Create.NewFamilyInstance(P(o.Center, level.Elevation), symbol, host, level, StructuralType.NonStructural);
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
        }

        private void PlaceColumn(ColumnDto c, Level level)
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
            var instance = _doc.Create.NewFamilyInstance(point, symbol, level, StructuralType.NonStructural);
            if (Math.Abs(c.RotationDeg) > 0.01)
            {
                // По часовой на плане Kepler = против часовой в Revit.
                var axis = Line.CreateBound(point, point + XYZ.BasisZ);
                ElementTransformUtils.RotateElement(_doc, instance.Id, axis, -c.RotationDeg * Math.PI / 180);
            }
            _report.Columns++;
        }

        private void PlaceRoom(RoomDto r, Level level)
        {
            if (r.Polygon.Count == 0) return;
            var cx = r.Polygon.Average(p => p.X);
            var cy = r.Polygon.Average(p => p.Y);
            var room = _doc.Create.NewRoom(level, new UV(Mm(cx), Mm(-cy)));
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
        }

        // Истинный север: в Kepler — угол по часовой от «вверх» плана дома.
        // ProjectPosition.Angle в Revit — угол от истинного севера к северу
        // проекта (против часовой положителен), поэтому знак меняется.
        private void SetTrueNorth(BuildingDto? building)
        {
            if (building == null || Math.Abs(building.TrueNorthDeg) < 0.01) return;
            var location = _doc.ActiveProjectLocation;
            var position = location.GetProjectPosition(XYZ.Zero);
            var angle = -building.TrueNorthDeg * Math.PI / 180;
            location.SetProjectPosition(XYZ.Zero, new ProjectPosition(position.EastWest, position.NorthSouth, position.Elevation, angle));
        }
    }
}
