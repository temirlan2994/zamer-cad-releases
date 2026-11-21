// Модель файла «Структурированный JSON» Kepler Plan (schema kepler-export/2).
// Координаты — мм, в осях дома, ось Y вниз (как на плане Kepler).
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Kepler.Revit
{
    public sealed class Pt
    {
        [JsonPropertyName("x")] public double X { get; set; }
        [JsonPropertyName("y")] public double Y { get; set; }
    }

    public sealed class Size2
    {
        [JsonPropertyName("w")] public double W { get; set; }
        [JsonPropertyName("h")] public double H { get; set; }
    }

    public sealed class BuildingDto
    {
        [JsonPropertyName("rotation_deg")] public double RotationDeg { get; set; }
        [JsonPropertyName("origin")] public Pt Origin { get; set; } = new();
        [JsonPropertyName("true_north_deg")] public double TrueNorthDeg { get; set; }
    }

    public sealed class RoomDto
    {
        [JsonPropertyName("id")] public string Id { get; set; } = "";
        [JsonPropertyName("number")] public string? Number { get; set; }
        [JsonPropertyName("type")] public string Type { get; set; } = "";
        [JsonPropertyName("name")] public string Name { get; set; } = "";
        [JsonPropertyName("polygon")] public List<Pt> Polygon { get; set; } = new();
        [JsonPropertyName("ceiling_height")] public double CeilingHeight { get; set; }
    }

    public sealed class WallDto
    {
        [JsonPropertyName("id")] public string Id { get; set; } = "";
        [JsonPropertyName("key")] public string Key { get; set; } = "";
        [JsonPropertyName("from")] public Pt From { get; set; } = new();
        [JsonPropertyName("to")] public Pt To { get; set; } = new();
        [JsonPropertyName("thickness")] public double Thickness { get; set; }
        [JsonPropertyName("type")] public string? Type { get; set; }
    }

    public sealed class OpeningDto
    {
        [JsonPropertyName("id")] public string Id { get; set; } = "";
        [JsonPropertyName("kind")] public string Kind { get; set; } = "";
        [JsonPropertyName("type")] public string? Type { get; set; }
        [JsonPropertyName("width")] public double Width { get; set; }
        [JsonPropertyName("height")] public double Height { get; set; }
        [JsonPropertyName("sill")] public double Sill { get; set; }
        [JsonPropertyName("center")] public Pt? Center { get; set; }
        [JsonPropertyName("wallKey")] public string? WallKey { get; set; }
    }

    public sealed class FreeWallDto
    {
        [JsonPropertyName("id")] public string Id { get; set; } = "";
        [JsonPropertyName("from")] public Pt From { get; set; } = new();
        [JsonPropertyName("to")] public Pt To { get; set; } = new();
        [JsonPropertyName("thickness")] public double Thickness { get; set; }
    }

    public sealed class ColumnDto
    {
        [JsonPropertyName("id")] public string Id { get; set; } = "";
        [JsonPropertyName("shape")] public string Shape { get; set; } = "rect";
        [JsonPropertyName("center")] public Pt Center { get; set; } = new();
        [JsonPropertyName("size")] public Size2 Size { get; set; } = new();
        [JsonPropertyName("rotation_deg")] public double RotationDeg { get; set; }
    }

    public sealed class LevelDto
    {
        [JsonPropertyName("id")] public string Id { get; set; } = "";
        [JsonPropertyName("name")] public string Name { get; set; } = "";
        [JsonPropertyName("elevation")] public double Elevation { get; set; }
        [JsonPropertyName("height")] public double Height { get; set; } = 3000;
        [JsonPropertyName("rooms")] public List<RoomDto> Rooms { get; set; } = new();
        [JsonPropertyName("walls")] public List<WallDto> Walls { get; set; } = new();
        [JsonPropertyName("openings")] public List<OpeningDto> Openings { get; set; } = new();
        [JsonPropertyName("free_walls")] public List<FreeWallDto> FreeWalls { get; set; } = new();
        [JsonPropertyName("columns")] public List<ColumnDto> Columns { get; set; } = new();
    }

    public sealed class KeplerExport
    {
        [JsonPropertyName("schema")] public string Schema { get; set; } = "";
        [JsonPropertyName("name")] public string Name { get; set; } = "";
        [JsonPropertyName("building")] public BuildingDto? Building { get; set; }
        [JsonPropertyName("levels")] public List<LevelDto> Levels { get; set; } = new();

        public static KeplerExport Load(string path)
        {
            var model = JsonSerializer.Deserialize<KeplerExport>(File.ReadAllText(path))
                ?? throw new InvalidDataException("Пустой файл");
            if (!model.Schema.StartsWith("kepler-export/"))
                throw new InvalidDataException($"Это не экспорт Kepler Plan (schema «{model.Schema}»). Экспорт → «Структурированный JSON».");
            return model;
        }
    }
}
