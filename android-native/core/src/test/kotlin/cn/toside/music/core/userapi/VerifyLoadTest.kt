package cn.toside.music.core.userapi

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class VerifyLoadTest {
    @Test
    fun verifyFailureDoesNotSettleAppInit() {
        val plan =
            UserApiInitPlanner.plan(
                UserApiInitEvent(verify = true, status = false, hasErrorMessage = true, settled = false),
            )
        assertFalse(plan.settle)
    }

    @Test
    fun verifySuccessSettlesAppInit() {
        val plan =
            UserApiInitPlanner.plan(
                UserApiInitEvent(verify = true, status = true, hasErrorMessage = false, settled = false),
            )
        assertTrue(plan.settle)
    }

    @Test
    fun verifyFailureDoesNotAlert() {
        val plan =
            UserApiInitPlanner.plan(
                UserApiInitEvent(verify = true, status = false, hasErrorMessage = true, settled = false),
            )
        assertFalse(plan.alert)
    }

    @Test
    fun normalFailureSettlesAndAlerts() {
        val plan =
            UserApiInitPlanner.plan(
                UserApiInitEvent(verify = false, status = false, hasErrorMessage = true, settled = false),
            )
        assertEquals(UserApiInitPlan(settle = true, alert = true), plan)
    }

    @Test
    fun normalFailureWithoutMessageDoesNotAlert() {
        val plan =
            UserApiInitPlanner.plan(
                UserApiInitEvent(verify = false, status = false, hasErrorMessage = false, settled = false),
            )
        assertFalse(plan.alert)
        assertTrue(plan.settle)
    }

    @Test
    fun alreadySettledIsNotSettledAgain() {
        val verifyPlan =
            UserApiInitPlanner.plan(
                UserApiInitEvent(verify = true, status = true, hasErrorMessage = false, settled = true),
            )
        assertFalse(verifyPlan.settle)
        val normalPlan =
            UserApiInitPlanner.plan(
                UserApiInitEvent(verify = false, status = false, hasErrorMessage = true, settled = true),
            )
        assertFalse(normalPlan.settle)
    }

    @Test
    fun verifySuccessDoesNotAlert() {
        val plan =
            UserApiInitPlanner.plan(
                UserApiInitEvent(verify = true, status = true, hasErrorMessage = false, settled = false),
            )
        assertFalse(plan.alert)
    }
}
