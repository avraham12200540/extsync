namespace ExtSync.Agent.Services;

public static class VersionUtil
{
    public static int[] Parse(string? v)
    {
        if (string.IsNullOrWhiteSpace(v)) return new[] { 0 };
        var parts = v.Split('.');
        var nums = new int[parts.Length];
        for (int i = 0; i < parts.Length; i++)
            nums[i] = int.TryParse(parts[i], out var n) ? n : 0;
        return nums;
    }

    /// <summary>True if a >= b (component-wise, like Chrome version comparison).</summary>
    public static bool Gte(string a, string b)
    {
        var pa = Parse(a);
        var pb = Parse(b);
        var len = Math.Max(pa.Length, pb.Length);
        for (int i = 0; i < len; i++)
        {
            var ai = i < pa.Length ? pa[i] : 0;
            var bi = i < pb.Length ? pb[i] : 0;
            if (ai != bi) return ai > bi;
        }
        return true;
    }
}
