// Итог импорта: что создано и что не получилось (без падения всего импорта).
using System.Collections.Generic;
using System.Text;

namespace Kepler.Revit
{
    public sealed class ImportReport
    {
        public int Levels, Walls, Doors, Windows, Rooms, Columns;
        public List<string> Warnings { get; } = new();

        public void Warn(string text)
        {
            if (Warnings.Count < 40) Warnings.Add(text);
        }

        public override string ToString()
        {
            var sb = new StringBuilder();
            sb.AppendLine($"Этажей: {Levels}, стен: {Walls}, дверей: {Doors}, окон: {Windows}, помещений: {Rooms}, колонн: {Columns}.");
            if (Warnings.Count > 0)
            {
                sb.AppendLine();
                sb.AppendLine("Замечания:");
                foreach (var w in Warnings) sb.AppendLine("• " + w);
            }
            return sb.ToString();
        }
    }
}
