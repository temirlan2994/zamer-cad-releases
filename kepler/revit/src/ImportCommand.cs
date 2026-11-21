// Команда Revit «Импорт Kepler Plan»: выбрать JSON и построить модель.
using System;
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
            using (var transaction = new Transaction(doc, "Импорт Kepler Plan"))
            {
                transaction.Start();
                try
                {
                    new KeplerImporter(doc, report).Import(model);
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
            return Result.Succeeded;
        }
    }
}
