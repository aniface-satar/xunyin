package cn.toside.music.core.userapi

import org.junit.Assert.assertEquals
import org.junit.Test

class UpdateAlertsTest {
    private fun settings(
        allowShowUpdateAlert: Boolean,
        autoUpdate: Boolean,
    ) = UpdateAlertSettings(autoUpdate = autoUpdate, allowShowUpdateAlert = allowShowUpdateAlert)

    @Test
    fun resolveFailureWithoutPopupShowsLightToast() {
        assertEquals(
            UpdateAlertPlan.Toast(ToastKind.FAILED),
            UpdateAlerts.plan(
                settings(allowShowUpdateAlert = false, autoUpdate = true),
                UpdateOutcome.Failed(UpdateFailureReason.RESOLVE_FAILED, "https://x.test/a.js"),
                "https://x.test/a.js",
            ),
        )
    }

    @Test
    fun rejectedScriptWithoutPopupShowsLightToast() {
        assertEquals(
            UpdateAlertPlan.Toast(ToastKind.FAILED),
            UpdateAlerts.plan(
                settings(allowShowUpdateAlert = false, autoUpdate = true),
                UpdateOutcome.Failed(UpdateFailureReason.REJECTED),
            ),
        )
    }

    @Test
    fun popupOffAndAutoUpdateOffIsSilent() {
        assertEquals(
            UpdateAlertPlan.Silent,
            UpdateAlerts.plan(
                settings(allowShowUpdateAlert = false, autoUpdate = false),
                null,
                "https://x.test/a.js",
            ),
        )
    }

    @Test
    fun popupOffStillShowsAutoUpdateSuccessToast() {
        assertEquals(
            UpdateAlertPlan.Toast(ToastKind.UPDATED),
            UpdateAlerts.plan(
                settings(allowShowUpdateAlert = false, autoUpdate = true),
                UpdateOutcome.Updated("x"),
            ),
        )
    }

    @Test
    fun popupOnWithoutAutoUpdateConfirmsScriptUrl() {
        assertEquals(
            UpdateAlertPlan.Confirm("https://x.test/a.js"),
            UpdateAlerts.plan(
                settings(allowShowUpdateAlert = true, autoUpdate = false),
                null,
                "https://x.test/a.js",
            ),
        )
    }

    @Test
    fun resolveFailureFallsBackToConfirmWithResolvedUrl() {
        assertEquals(
            UpdateAlertPlan.Confirm("https://x.test/raw.js"),
            UpdateAlerts.plan(
                settings(allowShowUpdateAlert = true, autoUpdate = true),
                UpdateOutcome.Failed(UpdateFailureReason.RESOLVE_FAILED, "https://x.test/raw.js"),
                "https://x.test/page",
            ),
        )
    }

    @Test
    fun resolveFailureWithoutOpenUrlFallsBackToTip() {
        assertEquals(
            UpdateAlertPlan.Tip,
            UpdateAlerts.plan(
                settings(allowShowUpdateAlert = true, autoUpdate = true),
                UpdateOutcome.Failed(UpdateFailureReason.RESOLVE_FAILED),
            ),
        )
    }

    @Test
    fun updatedToastsAndUnchangedIsSilent() {
        assertEquals(
            UpdateAlertPlan.Toast(ToastKind.UPDATED),
            UpdateAlerts.plan(settings(true, true), UpdateOutcome.Updated("x")),
        )
        assertEquals(UpdateAlertPlan.Silent, UpdateAlerts.plan(settings(true, true), UpdateOutcome.Unchanged))
    }

    @Test
    fun olderScriptUpdateIsSilentForBothPopupModes() {
        assertEquals(UpdateAlertPlan.Silent, UpdateAlerts.plan(settings(false, true), UpdateOutcome.Older))
        assertEquals(UpdateAlertPlan.Silent, UpdateAlerts.plan(settings(true, true), UpdateOutcome.Older))
    }

    @Test
    fun nonResolveFailureWithPopupOnIsSilent() {
        assertEquals(
            UpdateAlertPlan.Silent,
            UpdateAlerts.plan(settings(true, true), UpdateOutcome.Failed(UpdateFailureReason.REJECTED)),
        )
    }
}
