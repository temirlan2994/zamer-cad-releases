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
        [JsonPropertyName("label_point")] public Pt? LabelPoint { get; set; }
        [JsonPropertyName("void")] public bool Void { get; set; }
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
        [JsonPropertyName("height")] public double? Height { get; set; }
        [JsonPropertyName("base_offset")] public double BaseOffset { get; set; }
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
        [JsonPropertyName("part")] public string? Part { get; set; }
        [JsonPropertyName("top_from_owner_floor")] public double? SpanTop { get; set; }
        [JsonPropertyName("swingIn")] public bool? SwingIn { get; set; }
        [JsonPropertyName("hingeStart")] public bool? HingeStart { get; set; }
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
        [JsonPropertyName("concept")] public ConceptDto? Concept { get; set; }
        [JsonPropertyName("concept_geometry")] public List<ConceptGeometryDto> ConceptGeometry { get; set; } = new();
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

    public sealed class ConceptDto
    {
        [JsonPropertyName("project_id")] public string ProjectId { get; set; } = "";
        [JsonPropertyName("digest")] public string? Digest { get; set; }
        [JsonPropertyName("variant_id")] public string? VariantId { get; set; }
        [JsonPropertyName("geometry_complete")] public bool GeometryComplete { get; set; }
        [JsonPropertyName("construction")] public ConstructionReportDto? Construction { get; set; }
    }
    public sealed class ConstructionReportDto
    {
        [JsonPropertyName("config")] public ConstructionConfigDto? Config { get; set; }
    }
    public sealed class ConstructionConfigDto
    {
        [JsonPropertyName("layers")] public List<WallLayerDto> Layers { get; set; } = new();
    }
    public sealed class WallLayerDto
    {
        [JsonPropertyName("material")] public string Material { get; set; } = "";
        [JsonPropertyName("thickness")] public double Thickness { get; set; }
        [JsonPropertyName("bearing")] public bool Bearing { get; set; }
    }
    public sealed class Point3Dto
    {
        [JsonPropertyName("x")] public double X { get; set; }
        [JsonPropertyName("y")] public double Y { get; set; }
        [JsonPropertyName("z")] public double Z { get; set; }
    }
    public sealed class ConceptGeometryDto
    {
        [JsonPropertyName("id")] public string Id { get; set; } = "";
        [JsonPropertyName("category")] public string Category { get; set; } = "generic";
        [JsonPropertyName("level_id")] public string? LevelId { get; set; }
        [JsonPropertyName("kind")] public string Kind { get; set; } = "";
        [JsonPropertyName("faces")] public List<List<Point3Dto>> Faces { get; set; } = new();
    }
}
