using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Threading;

namespace PersonalAgent.WindowsHost.DesktopFixture;

internal static class Program
{
    [DllImport("user32.dll")] private static extern void keybd_event(byte key, byte scan, uint flags, nuint extra);
    [STAThread]
    private static void Main(string[] args)
    {
        if (args.Length != 2 || args[0] != "--directory" || !Path.IsPathFullyQualified(args[1]) || !Directory.Exists(args[1])) return;
        var directory = args[1];
        var application = new Application();
        var window = new Window { Title = "PersonalAgent synthetic desktop fixture", Width = 660, Height = 560, Left = 100, Top = 100,
            WindowStartupLocation = WindowStartupLocation.Manual, Topmost = false };
        var root = new StackPanel { Margin = new Thickness(24) };
        root.Children.Add(new TextBlock { Text = "Synthetic desktop acceptance — no private data", FontSize = 18, Margin = new Thickness(0, 0, 0, 12) });
        var text = new TextBox { Text = "synthetic-before", Height = 36, Margin = new Thickness(0, 0, 0, 12) };
        AutomationProperties.SetName(text, "Synthetic editor"); AutomationProperties.SetAutomationId(text, "synthetic-editor"); root.Children.Add(text);
        var button = new Button { Content = "Synthetic action", Height = 36, Margin = new Thickness(0, 0, 0, 12) };
        AutomationProperties.SetName(button, "Synthetic action"); root.Children.Add(button);
        var list = new ListBox { Height = 90, Margin = new Thickness(0, 0, 0, 12) };
        list.Items.Add("Synthetic first"); list.Items.Add("Synthetic second"); list.SelectedIndex = 0; root.Children.Add(list);
        var status = new TextBlock { Text = "Action count: 0", Height = 30 }; root.Children.Add(status);
        var scrollContent = new StackPanel();
        for (var i = 0; i < 20; i++) scrollContent.Children.Add(new TextBlock { Text = "Synthetic scroll row " + i, Height = 25 });
        var scroll = new ScrollViewer { Content = scrollContent, Height = 110, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
        AutomationProperties.SetName(scroll, "Synthetic scroll area"); root.Children.Add(scroll);
        var password = new PasswordBox { Height = 30, Visibility = Visibility.Collapsed }; AutomationProperties.SetName(password, "Synthetic protected input"); root.Children.Add(password);
        window.Content = root;
        var count = 0; var rendered = false; string? commandId = null; Window? overlay = null;
        void Save()
        {
            var handle = new WindowInteropHelper(window).Handle;
            var state = JsonSerializer.Serialize(new { pid = Environment.ProcessId, hwnd = handle.ToInt64().ToString(), title = window.Title,
                text = text.Text, actionCount = count, selected = list.SelectedIndex, scroll = scroll.VerticalOffset,
                active = window.IsActive, passwordVisible = password.IsVisible, rendered, commandId });
            var temporary = Path.Combine(directory, "state.tmp"); File.WriteAllText(temporary, state); File.Move(temporary, Path.Combine(directory, "state.json"), true);
        }
        text.TextChanged += (_, _) => Save(); button.Click += (_, _) => { count++; status.Text = "Action count: " + count; Save(); };
        list.SelectionChanged += (_, _) => Save(); scroll.ScrollChanged += (_, _) => Save();
        window.Activated += (_, _) => Save(); window.Deactivated += (_, _) => Save();
        window.ContentRendered += (_, _) => { rendered = true; text.Focus(); Save(); };
        var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(40) };
        timer.Tick += (_, _) =>
        {
            try
            {
                var file = Path.Combine(directory, "command.json"); if (!File.Exists(file)) return;
                using var document = JsonDocument.Parse(File.ReadAllText(file)); var command = document.RootElement;
                var id = command.GetProperty("id").GetString(); if (id == commandId) return; commandId = id;
                switch (command.GetProperty("action").GetString())
                {
                    case "foreground": window.Activate(); text.Focus(); break;
                    case "resize": window.Width += 25; break;
                    case "move": window.Left += 20; break;
                    case "password": password.Visibility = Visibility.Visible; break;
                    case "hide_password": password.Visibility = Visibility.Collapsed; break;
                    case "external_input":
                        // A synthetic event without the broker's private marker tests the hook generation boundary.
                        if (window.IsActive) { keybd_event(0x10, 0, 0, 0); keybd_event(0x10, 0, 2, 0); }
                        break;
                    case "overlay":
                        overlay = new Window { Title = "Synthetic overlay", Width = 240, Height = 150, Left = window.Left + 70, Top = window.Top + 70,
                            Owner = window, Topmost = true, ShowActivated = false, Content = new TextBlock { Text = "Synthetic occlusion fixture", Margin = new Thickness(15) } };
                        overlay.Show(); break;
                    case "close_overlay": overlay?.Close(); overlay = null; window.Activate(); break;
                    case "close": window.Close(); break;
                }
                Save();
            }
            catch { /* Test controller writes atomically; incomplete commands are retried. */ }
        };
        window.Closed += (_, _) => { timer.Stop(); overlay?.Close(); };
        timer.Start(); application.Run(window);
    }
}
