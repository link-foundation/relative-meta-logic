// SPDX-License-Identifier: Apache-2.0 OR MIT
use super::Visibility;
impl Visibility {
    pub(crate) fn is_inherited(&self) -> bool { matches!(self, Self::Inherited) }
}
impl Default for Visibility {
    fn default() -> Self { Self::Inherited }
}
