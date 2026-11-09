// Turns the Microsoft Store package's startup task on or off and prints its state, for main/startupTask.ts. Electron
// can't reach Windows' StartupTask API, and a helper outside the package, such as PowerShell, runs without the
// package's identity, which the API needs. This one ships inside the package. The Store job in package.yml compiles it
// with the .NET Framework compiler every Windows has.
//   startup-task.exe [on|off]   prints state=Enabled, Disabled, DisabledByUser…, state=Missing, or error=<message>
using System;
using System.Linq;
using Windows.ApplicationModel;

static class Program
{
    static int Main(string[] args)
    {
        try
        {
            var tasks = StartupTask.GetForCurrentPackageAsync().AsTask().Result;
            var task = tasks.FirstOrDefault(t => t.TaskId == "TostWorkStartup");
            if (task == null)
            {
                Console.WriteLine("state=Missing tasks=" + string.Join(",", tasks.Select(t => t.TaskId)));
                return 0;
            }
            var change = args.Length > 0 ? args[0] : "";
            if (change == "on") task.RequestEnableAsync().AsTask().Wait();
            if (change == "off") task.Disable();
            Console.WriteLine("state=" + task.State);
            return 0;
        }
        catch (Exception e)
        {
            var inner = e is AggregateException && e.InnerException != null ? e.InnerException : e;
            Console.WriteLine("error=" + inner.Message.Replace("\r", " ").Replace("\n", " "));
            return 1;
        }
    }
}
