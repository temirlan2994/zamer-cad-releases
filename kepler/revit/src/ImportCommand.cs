// Команда Revit «Импорт Kepler Plan»: выбрать JSON и построить модель.
using System;
using System.IO;
using System.Linq;
using System.Text.Json;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace Kepler.Revit
{
    [Transaction(TransactionMode.Manual)]
    public sealed class ImportCommand : IExternalCommand
    {
        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            var doc = commandData.Application.ActiveUIDocument?.Document;
            if (doc == null || doc.IsFamilyDocument)
            {
                message = "Откройте проект Revit (не семейство).";
                return Result.Failed;
            }

            var dialog = new FileOpenDialog("Kepler Plan JSON (*.json)|*.json") { Title = "Импорт Kepler Plan" };
            if (dialog.Show() != ItemSelectionDialogResult.Confirmed) return Result.Cancelled;
            var path = ModelPathUtils.ConvertModelPathToUserVisiblePath(dialog.GetSelectedModelPath());

            KeplerExport model;
            try
            {
                model = KeplerExport.Load(path);
            }
            catch (Exception error)
            {
                message = $"Не удалось прочитать файл: {error.Message}";
                return Result.Failed;
            }

            var report = new ImportReport();
            var choice = new TaskDialog("Kepler · обновление концепции")
            {
                MainInstruction = "Как импортировать концепцию?",
                MainContent = "Обновление затрагивает только элементы с метками Kepler этого проекта. Удалённые в исходнике элементы с пользовательскими зависимостями будут оставлены с замечанием. Старые импорты без меток не изменяются.",
                CommonButtons = TaskDialogCommonButtons.Cancel
            };
            choice.AddCommandLink(TaskDialogCommandLinkId.CommandLink1, "Обновить ранее импортированную концепцию");
            choice.AddCommandLink(TaskDialogCommandLinkId.CommandLink2, "Добавить отдельную копию");
            var selected = choice.Show();
            if (selected != TaskDialogResult.CommandLink1 && selected != TaskDialogResult.CommandLink2) return Result.Cancelled;
            using (var transaction = new Transaction(doc, "Импорт Kepler Plan"))
            {
                transaction.Start();
                try
                {
                    new KeplerImporter(doc, report).Import(model, selected == TaskDialogResult.CommandLink1);
                    transaction.Commit();
                }
                catch (Exception error)
                {
                    transaction.RollBack();
                    message = $"Импорт прерван: {error.Message}";
                    return Result.Failed;
                }
            }
            TaskDialog.Show("Kepler Plan", report.ToString());
            if (!string.IsNullOrWhiteSpace(model.Concept?.Digest))
            {
                var save = new FileSaveDialog("Отчёт Kepler (*.json)|*.json") { Title = "Сохранить отчёт для загрузки в Kepler" };
                if (save.Show() == ItemSelectionDialogResult.Confirmed)
                {
                    var destination = ModelPathUtils.ConvertModelPathToUserVisiblePath(save.GetSelectedModelPath());
                    try
                    {
                        var result = new
                        {
                            schema = "kepler-revit-report/1", digest = model.Concept.Digest,
                            projectId = model.Concept.ProjectId, createdAt = DateTime.UtcNow.ToString("O"),
                            revitVersion = commandData.Application.Application.VersionNumber,
                            counts = new { levels = report.Levels, walls = report.Walls, doors = report.Doors, windows = report.Windows, rooms = report.Rooms, columns = report.Columns,
                                updated = report.Updated, unchanged = report.Unchanged, removed = report.Removed, shapes = report.Shapes, voids = report.Voids },
                            warnings = report.Warnings.ToArray(),
                            scope = "Отчёт выполнения импорта. Визуальная и инженерная приёмка выполняются отдельно."
                        };
                        File.WriteAllText(destination, JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true }));
                    }
                    catch (Exception error) { TaskDialog.Show("Kepler Plan", $"Модель импортирована, но отчёт не сохранён: {error.Message}"); }
                }
            }
            return Result.Succeeded;
        }
    }
}
